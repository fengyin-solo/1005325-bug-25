import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from '@/views/Dashboard.vue'
const Trench = () => import('@/views/trench/index.vue')
const Stratum = () => import('@/views/stratum/index.vue')
const Feature = () => import('@/views/feature/index.vue')
const Find = () => import('@/views/find/index.vue')
const Sherd = () => import('@/views/sherd/index.vue')
const Bone = () => import('@/views/bone/index.vue')
const Flotation = () => import('@/views/flotation/index.vue')
const Dating = () => import('@/views/dating/index.vue')
const Survey = () => import('@/views/survey/index.vue')
const Photo = () => import('@/views/photo/index.vue')
const PhotoDetail = () => import('@/views/photo/detail.vue')
const Diary = () => import('@/views/diary/index.vue')
const Labor = () => import('@/views/labor/index.vue')
const Tool = () => import('@/views/tool/index.vue')
const Safety = () => import('@/views/safety/index.vue')
const Packing = () => import('@/views/packing/index.vue')
const Conserve = () => import('@/views/conserve/index.vue')
const Briefing = () => import('@/views/briefing/index.vue')
const Acceptance = () => import('@/views/acceptance/index.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/trench', name: 'trench', component: Trench },
    { path: '/stratum', name: 'stratum', component: Stratum },
    { path: '/feature', name: 'feature', component: Feature },
    { path: '/find', name: 'find', component: Find },
    { path: '/sherd', name: 'sherd', component: Sherd },
    { path: '/bone', name: 'bone', component: Bone },
    { path: '/flotation', name: 'flotation', component: Flotation },
    { path: '/dating', name: 'dating', component: Dating },
    { path: '/survey', name: 'survey', component: Survey },
    { path: '/photo', name: 'photo', component: Photo },
    { path: '/photo/:id(\\d+)', name: 'photo-detail', component: PhotoDetail },
    { path: '/diary', name: 'diary', component: Diary },
    { path: '/labor', name: 'labor', component: Labor },
    { path: '/tool', name: 'tool', component: Tool },
    { path: '/safety', name: 'safety', component: Safety },
    { path: '/packing', name: 'packing', component: Packing },
    { path: '/conserve', name: 'conserve', component: Conserve },
    { path: '/briefing', name: 'briefing', component: Briefing },
    { path: '/acceptance', name: 'acceptance', component: Acceptance },
  ],
})

export default router
