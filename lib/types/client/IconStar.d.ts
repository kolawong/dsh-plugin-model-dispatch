/**
 * Favorite star for model rows: same 20x20, one-pixel stroke language as the
 * product icon set (ui-primitives), filled when the route is favorited.
 */
import type { SVGProps } from 'react';
export interface IconStarProps extends SVGProps<SVGSVGElement> {
    size?: number;
    filled?: boolean;
}
export declare function IconStar({ size, filled, className, ...rest }: IconStarProps): import("react").JSX.Element;
