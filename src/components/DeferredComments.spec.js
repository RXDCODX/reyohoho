import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const load = vi.fn()

describe('deferred movie comments', () => {
  let wrapper
  let intersect
  let disconnect

  beforeEach(() => {
    vi.resetModules()
    load.mockReset().mockResolvedValue(undefined)
    vi.doMock('./Comments.vue', async () => {
      await load()
      return { default: { props: ['movieId'], template: '<p>Comments for {{ movieId }}</p>' } }
    })
    disconnect = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback) {
          intersect = callback
        }
        observe() {}
        disconnect() {
          disconnect()
        }
      }
    )
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.doUnmock('./Comments.vue')
    vi.unstubAllGlobals()
  })

  it('avoids loading offscreen comments and loads them when approaching the viewport', async () => {
    const Component = (await import('./DeferredComments.vue')).default
    wrapper = mount(Component, { props: { movieId: '123' } })
    await flushPromises()
    expect(load).not.toHaveBeenCalled()
    intersect([{ isIntersecting: false }])
    await flushPromises()
    expect(load).not.toHaveBeenCalled()
    intersect([{ isIntersecting: true }])
    await flushPromises()
    expect(wrapper.text()).toBe('Comments for 123')
    expect(disconnect).toHaveBeenCalled()
    await wrapper.setProps({ movieId: '456' })
    expect(wrapper.text()).toBe('Comments for 456')
  })

  it('allows manual loading and retries a failed chunk download', async () => {
    load.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const Component = (await import('./DeferredComments.vue')).default
    wrapper = mount(Component, { props: { movieId: '789' } })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('button').text()).toContain('Повторить')
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toBe('Comments for 789')
  })

  it('loads without IntersectionObserver and ignores a download completing after unmount', async () => {
    let finish
    load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal('IntersectionObserver', undefined)
    const Component = (await import('./DeferredComments.vue')).default
    wrapper = mount(Component, { props: { movieId: '123' } })
    await flushPromises()
    expect(load).toHaveBeenCalledOnce()
    wrapper.unmount()
    finish()
    await flushPromises()
    expect(wrapper.find('p').exists()).toBe(false)
  })
})
