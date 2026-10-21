import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ToastMessage from './ToastMessage.vue'

describe('notification lifecycle', () => {
  afterEach(() => vi.useRealTimers())

  it('clears its pending timer when the route unmounts the notification', () => {
    vi.useFakeTimers()
    const wrapper = mount(ToastMessage)
    wrapper.vm.showNotification('Local message', 5000)
    expect(vi.getTimerCount()).toBe(1)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces the previous expiry and clears the timer on manual dismissal', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ToastMessage)
    wrapper.vm.showNotification('First', 5000)
    wrapper.vm.showNotification('Second', 10000)
    await wrapper.vm.$nextTick()
    expect(vi.getTimerCount()).toBe(1)
    await wrapper.find('.close-btn').trigger('click')
    expect(vi.getTimerCount()).toBe(0)
    wrapper.unmount()
  })
})
