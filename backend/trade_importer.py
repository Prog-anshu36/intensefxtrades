"""Generic closed-trade CSV adapter. Prices are never inferred from market data."""
import csv
import hashlib
import io
import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

ALIASES = {
    'symbol': ('symbol', 'ticker'), 'type': ('direction', 'type', 'side'),
    'opened_at': ('entry_time', 'opened_at', 'open_time'),
    'closed_at': ('exit_time', 'closed_at', 'close_time'),
    'entry': ('entry_price', 'entry', 'open_price'), 'exit': ('exit_price', 'exit', 'close_price'),
    'lots': ('quantity', 'lots', 'lot_size', 'volume'), 'pnl': ('pnl', 'net_pnl', 'profit'),
    'commission': ('commission',), 'swap': ('swap',), 'sl': ('stop_loss', 'sl'),
    'tp': ('take_profit', 'tp'), 'strategy': ('strategy',), 'notes': ('notes',), 'tags': ('tags',),
}

def number(value, field, positive=False):
    try:
        result = Decimal(str(value).strip())
    except InvalidOperation:
        raise ValueError(f'{field}: enter a valid decimal number') from None
    if not result.is_finite() or (positive and result <= 0):
        raise ValueError(f'{field}: must be finite' + (' and positive' if positive else ''))
    return result

def utc_time(value, field):
    try:
        dt = datetime.fromisoformat(str(value).strip().replace('Z', '+00:00'))
    except ValueError:
        raise ValueError(f'{field}: use ISO date/time (for example 2025-01-01T09:00:00Z)') from None
    # Generic CSV contract: unqualified timestamps are UTC, never browser local time.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()

def fingerprint(trade):
    values = [str(trade.get('symbol', '')).upper(), str(trade.get('type', '')).upper()]
    for key in ('opened_at', 'closed_at'):
        try:
            values.append(utc_time(trade.get(key), key))
        except ValueError:
            values.append(trade.get(key))
    for key in ('entry', 'exit', 'lots'):
        try:
            values.append(str(Decimal(str(trade.get(key))).normalize()))
        except InvalidOperation:
            values.append(trade.get(key))
    return hashlib.sha256(json.dumps(values, separators=(',', ':')).encode()).hexdigest()

def inspect_columns(text):
    if len(text.encode('utf-8')) > 10 * 1024 * 1024:
        raise ValueError('CSV exceeds the 10 MB limit.')
    text = text.lstrip('\ufeff')
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=',;\t')
    except csv.Error:
        dialect = csv.excel
    headers = csv.DictReader(io.StringIO(text), dialect=dialect).fieldnames or []
    if not headers or len(headers) != len(set(headers)):
        raise ValueError('Use a nonempty CSV with unique column headers.')
    normalized = {h.strip().lower().replace(' ', '_'): h for h in headers}
    return {'headers': headers, 'columns': {field: next((normalized[a] for a in aliases if a in normalized), None) for field, aliases in ALIASES.items()}}

def parse_trades(text, existing, contracts, mapping=None):
    if len(text.encode('utf-8')) > 10 * 1024 * 1024:
        raise ValueError('CSV exceeds the 10 MB limit. Split it into smaller files.')
    text = text.lstrip('\ufeff')
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=',;\t')
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    headers = reader.fieldnames or []
    if not headers:
        raise ValueError('CSV is empty or has no header row.')
    normalized = {h.strip().lower().replace(' ', '_'): h for h in headers}
    columns = {field: next((normalized[a] for a in aliases if a in normalized), None) for field, aliases in ALIASES.items()}
    for field, header in (mapping or {}).items():
        if field not in ALIASES or (header and header not in headers):
            raise ValueError('Column mapping contains an unknown field or header.')
        columns[field] = header or None
    required = ('symbol', 'type', 'opened_at', 'closed_at', 'entry', 'exit', 'lots')
    missing = [k for k in required if not columns[k]]
    if missing:
        raise ValueError('Map the missing columns: ' + ', '.join(missing))
    known = {fingerprint(t) for t in existing}
    trades, errors, duplicates = [], [], 0
    for line, row in enumerate(reader, 2):
        if line > 100002:
            raise ValueError('Maximum 100,000 trades per import.')
        if not any(v for v in row.values()):
            continue
        try:
            if None in row or any(value is None for value in row.values()):
                raise ValueError('Row has a different number of columns than the header.')
            def get(field):
                return (row.get(columns[field]) or '').strip() if columns[field] else ''
            symbol = get('symbol').upper()
            if symbol not in contracts:
                raise ValueError('symbol: unsupported instrument; a contract specification is required')
            side = {'LONG': 'BUY', 'SHORT': 'SELL'}.get(get('type').upper(), get('type').upper())
            if side not in ('BUY', 'SELL'):
                raise ValueError('direction: use BUY/SELL or LONG/SHORT')
            opened, closed = utc_time(get('opened_at'), 'entry_time'), utc_time(get('closed_at'), 'exit_time')
            if datetime.fromisoformat(closed) < datetime.fromisoformat(opened):
                raise ValueError('exit_time: cannot precede entry_time')
            entry, exit_price, lots = [number(get(k), k, True) for k in ('entry', 'exit', 'lots')]
            commission = number(get('commission') or 0, 'commission')
            if commission < 0:
                raise ValueError('commission: must be a positive cost')
            swap = number(get('swap') or 0, 'swap')
            gross = (exit_price - entry) * lots * Decimal(str(contracts[symbol])) * (1 if side == 'BUY' else -1)
            net = number(get('pnl'), 'pnl') if get('pnl') else gross - commission + swap
            trade = dict(symbol=symbol, type=side, entry=float(entry), exit=float(exit_price), lots=float(lots),
                         opened_at=opened, closed_at=closed, commission=float(commission), swap=float(swap),
                         gross_pnl=float(gross), pnl=float(net), result='WIN' if net > 0 else 'LOSS' if net < 0 else 'BREAKEVEN',
                         reason='CSV_IMPORT', strategy=get('strategy'), notes=get('notes'),
                         tags=list(dict.fromkeys(t.strip() for t in get('tags').split('|') if t.strip())))
            for key in ('sl', 'tp'):
                trade[key] = float(number(get(key), key, True)) if get(key) else None
            direction = 1 if side == 'BUY' else -1
            if trade['sl'] is not None and direction * (trade['entry'] - trade['sl']) <= 0:
                raise ValueError('stop_loss: must be on the risk side of entry')
            if trade['tp'] is not None and direction * (trade['tp'] - trade['entry']) <= 0:
                raise ValueError('take_profit: must be on the reward side of entry')
            trade['risk'] = float(abs(entry - Decimal(str(trade['sl']))) * lots * Decimal(str(contracts[symbol]))) if trade['sl'] else None
            trade['r_multiple'] = float(net / Decimal(str(trade['risk']))) if trade['risk'] else None
            trade['duration_seconds'] = (datetime.fromisoformat(closed) - datetime.fromisoformat(opened)).total_seconds()
            key = fingerprint(trade)
            if key in known:
                duplicates += 1
                continue
            known.add(key)
            trades.append(trade)
        except (ValueError, TypeError, AttributeError) as error:
            errors.append({'row': line, 'error': str(error)})
    trades.sort(key=lambda t: (t['closed_at'], t['opened_at']))
    return {'trades': trades, 'errors': errors, 'duplicates': duplicates, 'columns': columns, 'headers': headers}
