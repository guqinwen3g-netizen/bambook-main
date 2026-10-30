/** Render local UI demonstrations with a still frame until the reader chooses to play. */
export function renderManualFigure(attrs) {
  const alt = /alt="([^"]*)"/.exec(attrs)?.[1] || '';
  const src = /src="([^"]*)"/.exec(attrs)?.[1] || '';
  if (!/^assets\/[\w/.-]+\.gif$/i.test(src)) return `<figure><img${attrs} loading="lazy" decoding="async">${alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`;
  const poster = src.replace(/\.gif$/i, '-poster.png');
  return `<figure class="demo"><img src="${poster}" alt="${alt}" data-animation="${src}" data-still="${poster}" loading="lazy" decoding="async"><figcaption><span>${alt}</span><span class="demo-controls"><button type="button" data-demo-toggle aria-pressed="false">播放操作演示</button><a href="${src}" target="_blank" rel="noopener">查看原尺寸</a></span></figcaption></figure>`;
}
