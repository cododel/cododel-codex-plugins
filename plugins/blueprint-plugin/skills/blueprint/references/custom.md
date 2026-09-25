# Custom React widgets

Only load this guide when the built-in catalog cannot express the case.

Write a local component and import it from MDX:

```mdx
import Capacity from './widgets/capacity.tsx'

<Custom id="capacity-block"><Capacity id="capacity" /></Custom>
```

```tsx
import { useBlueprintState } from '@blueprint/sdk'

export default function Capacity({ id }: { id: string }) {
  const [state, setState, confirmed] = useBlueprintState(
    id,
    { workers: 2 },
    { kind: 'capacity', version: 1 },
  )
  return <div>
    <label>Workers <input type="range" min={1} max={16}
      value={state.workers}
      onChange={e => setState({ workers: Number(e.target.value) })} /></label>
    <output>{state.workers}</output>
    {!confirmed && <button onClick={() => setState(state)}>Confirm</button>}
  </div>
}
```

State must be JSON. `setState` replaces the whole widget value. No updater functions. The optional third argument is the semantic definition: bump its version when interpretation changes. Without it, a document revision change conservatively asks for confirmation. `confirmed` and `touched` are separate: untouched defaults do not imply a user answer.

Imports: `react`, `react/jsx-runtime`, `@blueprint/sdk`, `@blueprint/components`, and local MDX/TSX/TS/JSX/JS/JSON/CSS/SVG. SVG imports return data URLs. CSS executes in the shared page: scope selectors under your custom block to avoid affecting the shell. Remote imports, npm installation and runtime networking are not supported. Standard Markdown image URLs cannot load remote images; use a bundled SVG import or data URL.

Use controlled inputs, labels and keyboard-accessible buttons. Prefer SVG for custom diagrams. Use `useEffect` cleanup for intervals, observers, subscriptions and global event listeners. Avoid infinite animations. Do not retain previous revisions in global arrays.

The document executes as trusted project code in the page DOM, with the same privileges as the shell. Keep code within its own component; use the SDK rather than accessing tokens or calling persistence APIs directly. The SDK carries state; annotation selection and persistence are provided by the host. Wrap selectable custom content in `<Custom id="...">` for a stable annotation anchor. A broken component must not be used as evidence of user acceptance.

## Layout

Document content is centered and capped at 1040px; prose uses a 75ch measure. Questions and checklists are capped at 720px. `<Custom size="compact">` (default) caps its content at 560px; `standard` at 720px; `wide` at 1040px. These are maximum widths, not fixed widths. Use `wide` only for content that needs it, such as a dense comparison. Overflow stays local to the custom block.

Keep chart captions in HTML with normal font sizes and use fixed CSS heights for simple bars (e.g. 14px). An SVG viewBox alone scales labels and strokes along with its container: provide an explicit intrinsic width or maximum width. Avoid viewport-based font sizes. Test both a narrow panel and a wide desktop. Layout-only changes must keep widget IDs and semantic definitions unchanged.
