<script setup lang="ts">
import { useProducts } from '../composables/useProducts'
import ProductCard from '../components/ProductCard.vue'

const products = useProducts()
</script>

<template>
  <main style="max-width: 720px; margin: 2rem auto; font-family: system-ui;">
    <h1>Products</h1>
    <ul style="list-style: none; padding: 0;">
      <li v-for="product in products" :key="product.id">
        <ProductCard :product="product" />
      </li>
    </ul>
  </main>
</template>
