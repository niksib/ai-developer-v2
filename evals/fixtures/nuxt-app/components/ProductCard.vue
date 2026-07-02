<script setup lang="ts">
import { formatPrice } from '../utils/formatPrice'
import type { Product } from '../composables/useProducts'

defineProps<{ product: Product }>()
</script>

<template>
  <article
    data-testid="product-card"
    style="border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 8px 0;"
  >
    <h2 data-testid="product-name">{{ product.name }}</h2>
    <p data-testid="product-price">{{ formatPrice(product.priceCents) }}</p>
  </article>
</template>
