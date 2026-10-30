import {expect,it} from 'vitest';
import {renderManualFigure} from './manual-media.mjs';

it('shows a still frame and explicit playback for real UI GIF demonstrations',()=>{
 const html=renderManualFigure(' src="assets/production/release.gif" alt="放行开产"');
 expect(html).toContain('src="assets/production/release-poster.png"');
 expect(html).toContain('data-animation="assets/production/release.gif"');
 expect(html).toContain('aria-pressed="false"');
 expect(html).toContain('播放操作演示');
});
it('keeps screenshots as images without inventing an animation or poster',()=>{
 const html=renderManualFigure(' src="assets/production/screen.png" alt="生产单"');
 expect(html).toContain('src="assets/production/screen.png"');
 expect(html).not.toContain('data-animation');
});
