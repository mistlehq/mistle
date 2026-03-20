# React Effects In Dashboard

This dashboard follows a narrow rule for `useEffect`:

- use `useEffect` only for external synchronization
- do not use `useEffect` for app-internal React state flow

## Core Rule

Use `useEffect` when React must set up, update, or clean up something outside React state.

Common valid cases:

- browser or DOM subscriptions
- timers or intervals with cleanup
- imperative widgets
- sockets or streams
- terminal or session lifecycle wiring
- registration with an external owner when cleanup is required

Do not use `useEffect` just to move data between props, state, and query results inside React.

## Decision Tree

Before adding `useEffect`, ask:

1. Is this value derived from props, state, or query data?
   If yes, derive it during render.
2. Is this triggered by a user action?
   If yes, run it in the event handler or mutation callback.
3. Is this server data?
   If yes, use TanStack Query.
4. Do I need a fresh component instance for a new entity or identifier?
   If yes, use `key`-based remounting or move the state boundary.
5. Am I synchronizing with an external system that needs setup and cleanup?
   If yes, `useEffect` may be correct.

## Preferred Alternatives

### Derive During Render

If a value can be computed from current React inputs, compute it inline instead of storing mirrored state.

Bad:

```tsx
const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);

useEffect(() => {
  setFilteredProducts(products.filter((product) => product.inStock));
}, [products]);
```

Good:

```tsx
const filteredProducts = products.filter((product) => product.inStock);
```

### Use TanStack Query For Server Data

Do not fetch in `useEffect`.

Bad:

```tsx
useEffect(() => {
  void fetchThing(id).then(setThing);
}, [id]);
```

Good:

```tsx
const thingQuery = useQuery({
  queryKey: ["thing", id],
  queryFn: async () => fetchThing(id),
});
```

### Run User Actions In Event Handlers

Do not route actions through state flags so an effect can do the real work.

Bad:

```tsx
const [shouldSave, setShouldSave] = useState(false);

useEffect(() => {
  if (!shouldSave) {
    return;
  }

  void save();
  setShouldSave(false);
}, [shouldSave]);
```

Good:

```tsx
function handleSave(): void {
  void save();
}
```

### Reset With `key` Or A Better State Boundary

If the requirement is "treat this as a fresh instance when the id changes", use remount semantics or move local state lower in the tree.

Bad:

```tsx
useEffect(() => {
  setDraftName(record.name);
}, [record.id, record.name]);
```

Better:

```tsx
return <Editor key={record.id} record={record} />;
```

## Disallowed Effect Patterns

Avoid these patterns:

- copying props into local state
- copying query data into local state
- copying one piece of React state into another
- fetching data
- relaying user actions through state flags
- resetting local state because an id, route param, or selected item changed
- keeping two pieces of React state synchronized with each other

These patterns usually create extra renders, stale intermediate state, hidden control flow, or loop hazards.

## Allowed Effect Patterns

These are normal uses of `useEffect` in this app:

- `matchMedia` subscription and cleanup
- timer lifecycle for visible UI behavior
- XTerm or other imperative widget setup and disposal
- terminal stream wiring and resize handling
- context registration with cleanup on unmount

## Practical Review Smells

Be suspicious when you see:

- `useEffect(() => setX(...), [...])`
- `useEffect(() => { fetch(...).then(setState) }, [...])`
- state flags whose only purpose is to trigger an effect
- dependency arrays that include state the effect itself updates
- an effect that exists only to repair stale local state after render
