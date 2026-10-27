/* Dedicated prop ledgers and views; shared chart/data/analytics implementations. */
(() => {
  'use strict';
  const contexts = new Map();
  const owner = () => Store.state.active_account_id || Store.state.id;
  const user = () => Store.state.user?.id || Store.state.active_user_id || 'local';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const emptyState = balance => ({ balance, initial_balance: balance, history: [], active_trades: [], pending_orders: [], journal: [], settings: { symbol: 'XAUUSD', timeframe: '1m' }, practice_workspace: true });
  const keyFor = attempt => `${user()}:${owner()}:${attempt?.id}:phase-${attempt?.phase}`;
  function header(attempt) {
    return `<div class="prop-workspace-header"><div><span class="propfirm-eyebrow">PROP FIRM PRACTICE · XAUUSD</span><b>${escape(attempt.name || PropFirmRules[attempt.model].name)} · Phase ${attempt.phase} · $${attempt.startingBalance.toLocaleString()}</b><label>Practice account <select id="propWorkspaceAccount" aria-label="Practice account">${PropFirmSession.attempts.map(a => `<option value="${escape(a.id)}" ${a.id === attempt.id ? 'selected' : ''}>${escape(a.name || PropFirmRules[a.model].name)} · Phase ${a.phase}${a.archived ? ' · Archived' : ''}</option>`).join('')}</select></label></div><nav aria-label="Prop practice views">${[['prop-firm-session','Objectives'],['prop-chart','Practice Chart'],['prop-performance','Performance'],['prop-trade-analysis','Trade Analysis'],['prop-ai-coach','AI Coach']].map(([route,label]) => `<button type="button" data-prop-route="${route}" class="${Router.current === route ? 'active' : ''}">${label}</button>`).join('')}</nav></div>`;
  }
  function bindHeader(container) {
    container.querySelectorAll('[data-prop-route]').forEach(button => button.addEventListener('click', () => Router.go(button.dataset.propRoute)));
    container.querySelector('#propWorkspaceAccount')?.addEventListener('change', event => { PropFirmSession.activate(event.target.value); Router.go(Router.current); });
  }
  function missingRound() {
    return '<section class="propfirm-card propfirm-empty"><b>Select a prop practice round</b><p>Start a round or select one from practice history to open its independent chart and analysis.</p><button type="button" class="propfirm-primary" data-prop-route="prop-firm-session">Open Prop Firm Session →</button></section>';
  }
  const Workspace = {
    hasState(attempt) { return !!contexts.get(keyFor(attempt))?.loaded; },
    stateForAttempt(attempt) { return contexts.get(keyFor(attempt))?.store.state || emptyState(attempt?.startingBalance || 5000); },
    async ensure(attempt) {
      if (!attempt) throw new Error('Select a prop practice round first.');
      const key = keyFor(attempt);
      let context = contexts.get(key);
      if (context?.loaded) return context;
      if (context?.loading) return context.loading;
      const ownerId = owner();
      const api = API.forPractice(`${attempt.id}-phase-${attempt.phase}`, ownerId);
      const store = {
        state: emptyState(attempt.startingBalance),
        metrics(history) { return Store.metrics.call(this, history); },
        equity() { return Store.equity.call(this); },
        floatingPnl() { return Store.floatingPnl.call(this); },
        async refresh() {
          const data = await api.getState();
          if (data.error) throw new Error(data.error);
          this.state = { ...data, practice_workspace: true };
          return this.state;
        },
      };
      context = { key, ownerId, store, api, loaded: false, chart: null };
      contexts.set(key, context);
      context.loading = (async () => {
        const data = await api.initializePractice({ balance: attempt.startingBalance, model: attempt.model });
        store.state = { ...data, active_account_id: data.id, practice_workspace: true };
        context.loaded = true;
        return context;
      })().catch(error => { contexts.delete(key); throw error; });
      return context.loading;
    },
    activeChart() { return Router.current === 'prop-chart' ? window.PagePropChart.context?.chart : null; },
    sessionIndicator() {
      const attempt = PropFirmSession.selected();
      if (!attempt || !window.FXNAsianSessionRange) return null;
      const context = contexts.get(keyFor(attempt));
      if (context?.chart) return context.chart.getFxnIndicator();
      let config = {};
      try { config = JSON.parse(ChartAccountState.storageFor(`prop:${keyFor(attempt)}`).getItem('tfb_fxn_asian_range_v1') || '{}'); } catch (_) {}
      return new FXNAsianSessionRange({ dailyUtcOffset: 5.5, ...config });
    },
    chart(context, attempt) {
      if (context.chart) return context.chart;
      // Retain one mounted/cached practice chart rather than a candle buffer per round.
      for (const previous of contexts.values()) if (previous.chart) {
        previous.chart.cleanup(); previous.chart.drawingEngine?.destroy?.(); previous.chart = null;
      }
      const current = () => owner() === context.ownerId && PropFirmSession.selected()?.id === attempt.id && keyFor(attempt) === context.key;
      const controller = {
        canEvaluateAt(time) {
          const floor = PropFirmSession.tradingTimeFloor(PropFirmSession.selected(), context.store.state);
          return current() && (floor == null || time >= floor);
        },
        canTradeAt(time, symbol) {
          return current() ? PropFirmSession.canTradeAt(time, symbol) : { ok: false, message: 'Practice context changed. Reopen the chart.' };
        },
        onMarketCandle(time, state) {
          if (!current()) return null;
          const result = PropFirmSession.onMarketCandle(time, state);
          if (['failed', 'expired'].includes(attempt.status) && (state.active_trades.length || state.pending_orders.length)) {
            return { ...result, failed: true, liquidate: state.active_trades, reason: attempt.breachReason };
          }
          return result;
        },
        syncChartBadge() { if (current()) PropFirmSession.syncChartBadge(); },
      };
      const storage = ChartAccountState.storageFor(`prop:${context.key}`);
      context.chart = createBacktestingWorkspace({ store: context.store, api: context.api, storage,
        scope: context.key, practiceController: controller, allowedSymbols: ['XAUUSD'] });
      return context.chart;
    },
  };
  window.PropPracticeWorkspace = Workspace;

  function viewPage(source = null) {
    return {
      generation: 0, context: null, view: null,
      render() {
        PropFirmSession.load();
        const attempt = PropFirmSession.selected();
        return attempt ? `${header(attempt)}<div class="prop-workspace-body" role="status">Opening your independent XAUUSD practice workspace…</div>` : missingRound();
      },
      async afterRender(container) {
        bindHeader(container);
        const attempt = PropFirmSession.selected();
        if (!attempt) return;
        const generation = ++this.generation;
        const route = Router.current;
        const key = keyFor(attempt);
        try {
          const context = await Workspace.ensure(attempt);
          await context.store.refresh();
          if (generation !== this.generation || Router.current !== route || key !== keyFor(PropFirmSession.selected())) return;
          this.context = context;
          PropFirmSession.currentMarketTime = attempt.lastMarketTimestamp || null;
          if (source) {
            if (source === PageAICoach && !context.store.state.history?.length) {
              container.innerHTML = header(attempt) + '<section class="propfirm-card"><h2>No closed prop trades yet</h2><p>Complete and journal trades in this account to receive analysis based on your own results.</p><button type="button" class="propfirm-primary" data-prop-route="prop-chart">Open XAUUSD practice chart →</button></section>';
              bindHeader(container);
              return;
            }
            this.view = Object.create(source);
            this.view._store = context.store;
            if ('period' in source) this.view.period = 'All Time';
            const render = source.render;
            this.view.render = () => header(attempt) + render.call(this.view);
            const afterRender = source.afterRender;
            this.view.afterRender = element => { bindHeader(element); afterRender?.call(this.view, element); };
            container.innerHTML = this.view.render();
            this.view.afterRender(container);
          } else {
            const chart = Workspace.chart(context, attempt);
            if (!chart._initialized) chart.init();
            // Render into a child host; chart refreshes cannot erase the navigation.
            container.innerHTML = header(attempt) + '<div class="prop-chart-host"></div>';
            bindHeader(container);
            const host = container.querySelector('.prop-chart-host');
            host.innerHTML = chart.render();
            chart.afterRender(host);
          }
        } catch (error) {
          if (generation !== this.generation || Router.current !== route) return;
          container.innerHTML = `${header(attempt)}<section class="propfirm-card"><p role="alert">${escape(error.message)}</p><button type="button" class="propfirm-primary" id="propWorkspaceRetry">Retry workspace</button></section>`;
          bindHeader(container);
          container.querySelector('#propWorkspaceRetry')?.addEventListener('click', () => Router.go(route));
        }
      },
      cleanup() {
        ++this.generation;
        if (!source && this.context?.chart) {
          const chart = this.context.chart;
          chart.saveDrawingStorage(); chart.saveReplayStorage(); chart.cleanup();
          chart.container = null;
        }
        this.context = null;
        this.view = null;
      },
    };
  }
  window.PagePropChart = viewPage();
  window.PagePropPerformance = viewPage(PagePerformance);
  window.PagePropTradeAnalysis = viewPage(PageTradeAnalysis);
  window.PagePropAICoach = viewPage(PageAICoach);
})();
