import { jsx as _jsx } from "react/jsx-runtime";
const PATH = 'M10 3.6l1.98 4.02 4.44.65-3.21 3.13.76 4.42L10 13.73l-3.97 2.09.76-4.42L3.58 8.27l4.44-.65L10 3.6Z';
export function IconStar({ size = 16, filled = false, className, ...rest }) {
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 20 20", fill: "none", className: className, "aria-hidden": true, focusable: "false", ...rest, children: _jsx("path", { d: PATH, fill: filled ? 'currentColor' : 'none', stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" }) }));
}
