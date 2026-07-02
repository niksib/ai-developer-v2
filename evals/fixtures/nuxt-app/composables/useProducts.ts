export interface Product {
  id: number
  name: string
  /** Price in integer cents. */
  priceCents: number
}

/** Sample product data for the eval sandbox. */
export function useProducts(): Product[] {
  return [
    { id: 1, name: 'Keyboard', priceCents: 4999 },
    { id: 2, name: 'Mouse', priceCents: 2550 },
    { id: 3, name: 'Monitor', priceCents: 19900 },
  ]
}
