import React from 'react';
import { cx } from './types';

export type SliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'min' | 'max'> & { value: number; min?: number; max?: number };
/** Mist 填充滑杆：原生输入负责拖动/键盘，独立轨道与短刻度负责呈现。 */
export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(function Slider({ value, min = 0, max = 100, className, style, disabled, ...rest }, ref) {
  const progress = Number.isFinite(value) && max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0;
  return <span className={cx('mist-slider', className)} data-disabled={disabled || undefined} data-empty={progress === 0 || undefined} style={{ '--mist-slider-progress': `${progress}%`, ...style } as React.CSSProperties}>
    <span className="mist-slider-track" aria-hidden="true"><span className="mist-slider-fill"><span className="mist-slider-mark" /></span></span>
    <input {...rest} ref={ref} type="range" className="mist-slider-input" min={min} max={max} value={value} disabled={disabled} />
  </span>;
});
