import React from 'react';
import { cx } from './types';

export type SliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'min' | 'max'> & { value: number; min?: number; max?: number };
/** Mist 滑杆：自定义轨道与胶囊滑块，保留原生触摸、键盘和表单语义。 */
export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(function Slider({ value, min = 0, max = 100, className, style, ...rest }, ref) {
  const progress = Number.isFinite(value) && max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0;
  return <input {...rest} ref={ref} type="range" className={cx('mist-slider', className)} min={min} max={max} value={value} style={{ '--mist-slider-progress': `${progress}%`, ...style } as React.CSSProperties} />;
});
