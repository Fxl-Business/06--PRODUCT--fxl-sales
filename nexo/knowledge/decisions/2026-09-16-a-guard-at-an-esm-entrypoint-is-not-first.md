# The first statement of an ESM entrypoint is not first

**Date:** 2026-09-16
**Surfaced by:** slice 02 of `feature-20260916-local-db-guard`

## The trap

A guard that must run before anything else in a process was placed as the first statement of `apps/api/src/server.ts`'s module body, below the static import list.
That is the natural reading of "first", and it is wrong.

ESM evaluates the ENTIRE static import graph before the first statement of the importing module's body runs.
Anything with a module-level side effect anywhere in that graph - a config load, a client construction, a pool, a throw - speaks before the guard does.
Here `middleware/app-auth.ts` loads the Hub configuration at its own top level and throws there, so the first run printed `HubConfigError` and NEVER the guard's lines.
The guard's verdict was buried under an unrelated module-load failure, and a green boot said nothing at all about the guard.

The minimal demonstration, if it ever needs re-proving:

```
side.mjs:  console.log("SIDE-EFFECT MODULE TOP LEVEL"); export const x = 1;
main.mjs:  import { x } from "./side.mjs"; console.log("FIRST BODY STATEMENT", x);

$ node main.mjs
SIDE-EFFECT MODULE TOP LEVEL
FIRST BODY STATEMENT 1
```

## The rule

An entrypoint that must guard something statically imports ONLY what the guard itself needs, and only modules that are pure with respect to the thing being guarded.
Everything else moves to `await import(...)` below the guard, in the original order, with the original binding names.

## What to prove afterwards, and how

The restructure is the risky part, so prove it mechanically rather than by eye:

- the body is byte-identical from the first construction statement onward (`diff <(tail -n +$OLD old) <(tail -n +$NEW new)`), so no registration moved;
- the dynamic-import specifier list is identical, specifier for specifier, to the old static list - module top-level side effects run in that order and it has to be preserved;
- every previously bound name still exists, with only the intended additions.

The decisive evidence is still behavioural: trigger the refusal and confirm the guard speaks and the process dies BEFORE the side effect that used to win.
That ordering is a stronger oracle than a successful boot, because a successful boot cannot distinguish a guard that ran from a guard that was never reached.

## Consequence to accept

The entrypoint becomes an async module.
That is fine while nothing imports it, and it is worth a comment the day something does.
