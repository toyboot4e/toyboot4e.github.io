; Local patch — NOT from Helix, NOT overwritten by vendor.sh (appended after the
; Helix query in highlight.ts, so it wins via last-pattern-wins).
;
; Colour a function used as a backtick infix operator (e.g. `div` in `(`div` 5)`
; or `x `div` y`) as a function, matching its prefix-call colour. Helix leaves it
; as a plain operator, which makes the same function look different infix vs prefix.
(infix_id (variable) @function)
