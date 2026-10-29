"""Reject Pages releases with missing website pages, assets or app links."""
from html.parser import HTMLParser
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        self.links.extend(value for key, value in attrs
                          if key in ('href', 'src') and value)


def check(output):
    output = Path(output).resolve()
    for name in ('index.html', 'features.html', 'prop-firm-practice.html',
                 'about.html', 'faq-contact.html', 'legal.html', '404.html'):
        page = output / name
        parser = Links()
        parser.feed(page.read_text(encoding='utf-8'))
        app_links = 0
        for link in parser.links:
            url = urlsplit(link)
            if url.scheme or url.netloc or not url.path:
                continue
            target = (page.parent / unquote(url.path)).resolve()
            if not target.is_relative_to(output) or not target.exists():
                raise ValueError(f'{name}: missing local target {link}')
            if target == output / 'app':
                app_links += 1
                if not (target / 'index.html').is_file():
                    raise ValueError('Application entry point missing')
        if not app_links:
            raise ValueError(f'{name}: no link to the web app')
    print('Website pages, local assets and application links verified.')


if __name__ == '__main__':
    check(sys.argv[1] if len(sys.argv) > 1 else '_site')
