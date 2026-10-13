import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import BaseModal from './BaseModal.vue'

describe('confirmation dialog keyboard', () => {
  it('focuses cancel, traps Tab in both directions, closes on Escape and restores focus', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const wrapper = mount(BaseModal, {
      attachTo: document.body,
      props: { isOpen: false, message: 'Delete?' }
    })
    await wrapper.setProps({ isOpen: true })
    await nextTick()
    const buttons = wrapper.findAll('button')
    expect(document.activeElement).toBe(buttons[0].element)
    await buttons[0].trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(buttons[1].element)
    await buttons[1].trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0].element)
    await buttons[0].trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ isOpen: false })
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
    trigger.remove()
  })
})
