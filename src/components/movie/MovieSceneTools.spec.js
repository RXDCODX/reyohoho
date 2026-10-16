import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MovieSceneTools from './MovieSceneTools.vue'

const { api, auth, push } = vi.hoisted(() => ({
  api: Object.fromEntries(
    [
      'getNudityInfoFromIMDB',
      'submitTiming',
      'updateTiming',
      'deleteTiming',
      'reportTiming',
      'getTopTimingSubmitters',
      'getAllTimingSubmissions',
      'approveTiming',
      'rejectTiming',
      'markAsCleanText',
      'voteOnTiming',
      'getTimingVote'
    ].map((name) => [name, vi.fn()])
  ),
  auth: { token: 'account-A', user: { id: 1, is_admin: true } },
  push: vi.fn()
}))
vi.mock('@/api/movies', () => api)
vi.mock('@/store/auth', () => ({ useAuthStore: () => auth }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/constants', () => ({ handleApiError: () => ({ message: 'API error' }) }))

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const timing = (id = 7) => ({
  id,
  username: 'author',
  user_id: 2,
  status: 'approved',
  timing_text: '00:10-00:20'
})
let wrappers
const render = (props = {}) => {
  const wrapper = mount(MovieSceneTools, {
    props: {
      movieId: '123',
      movieInfo: { imdb_id: 'tt123', nudity_timings: [timing()] },
      notify: vi.fn(),
      refreshMovie: vi.fn().mockResolvedValue(true),
      ...props
    },
    global: {
      stubs: {
        MovieTimingFormModal: {
          name: 'MovieTimingFormModal',
          props: ['modelValue'],
          emits: ['update:modelValue', 'submit', 'close'],
          template: '<div class="test-timing-form" />'
        },
        MovieReportTimingModal: true,
        MovieTopSubmittersModal: true,
        MovieAllTimingsModal: true
      }
    }
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('on-demand movie scene tools', () => {
  beforeEach(() => {
    wrappers = []
    Object.values(api).forEach((mock) => mock.mockReset())
    api.getNudityInfoFromIMDB.mockResolvedValue({ nudity_info: 'Guide contents' })
    api.getTimingVote.mockResolvedValue({ upvotes: 4, downvotes: 1, vote_score: 3 })
    auth.token = 'account-A'
    delete window.electronAPI
  })
  afterEach(() => {
    wrappers.forEach((wrapper) => wrapper.unmount())
    delete window.electronAPI
    vi.restoreAllMocks()
  })

  it('requests only the opened panel and does not mutate the movie response', async () => {
    const movieInfo = { imdb_id: 'tt123', nudity_timings: [timing()] }
    const wrapper = render({ movieInfo })
    await flushPromises()
    expect(api.getNudityInfoFromIMDB).not.toHaveBeenCalled()
    expect(api.getTimingVote).not.toHaveBeenCalled()
    await wrapper.setProps({ mode: 'guide' })
    await flushPromises()
    expect(wrapper.text()).toContain('Guide contents')
    expect(api.getNudityInfoFromIMDB).toHaveBeenCalledWith('tt123')
    expect(api.getTimingVote).not.toHaveBeenCalled()
    await wrapper.setProps({ mode: 'timings' })
    await flushPromises()
    expect(api.getTimingVote).toHaveBeenCalledWith(7)
    expect(wrapper.get('.vote-score-badge.positive').text()).toBe('3')
    expect(movieInfo.nudity_timings[0]).not.toHaveProperty('voteScore')
  })

  it('ignores a previous guide response after closing and reopening', async () => {
    const old = deferred()
    const current = deferred()
    api.getNudityInfoFromIMDB.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const wrapper = render({ mode: 'guide' })
    await wrapper.setProps({ mode: null })
    await wrapper.setProps({ mode: 'guide' })
    current.resolve({ nudity_info: 'Current guide' })
    await flushPromises()
    old.resolve({ nudity_info: 'Stale guide' })
    await flushPromises()
    expect(wrapper.text()).toContain('Current guide')
    expect(wrapper.text()).not.toContain('Stale guide')
    expect(wrapper.emitted('guide-loading').at(-1)).toEqual([false])
  })

  it('does not overwrite a submitted vote with an earlier vote read', async () => {
    const initialVote = deferred()
    api.getTimingVote.mockReturnValue(initialVote.promise)
    api.voteOnTiming.mockResolvedValue({ upvotes: 10, downvotes: 1, vote_score: 9 })
    const wrapper = render({ mode: 'timings' })
    await wrapper.get('.vote-btn-arrow.up').trigger('click')
    await flushPromises()
    expect(api.voteOnTiming).toHaveBeenCalledWith(7, 'upvote')
    expect(wrapper.get('.vote-score-badge').text()).toBe('9')
    initialVote.resolve({ upvotes: 0, downvotes: 4, vote_score: -4 })
    await flushPromises()
    expect(wrapper.get('.vote-score-badge.positive').text()).toBe('9')
  })

  it('ignores votes from a superseded movie response', async () => {
    const old = deferred()
    api.getTimingVote.mockReturnValueOnce(old.promise)
    const wrapper = render({ mode: 'timings' })
    await wrapper.setProps({ movieInfo: { imdb_id: 'tt123', nudity_timings: [timing(8)] } })
    await flushPromises()
    old.resolve({ vote_score: -10 })
    await flushPromises()
    expect(wrapper.get('.vote-score-badge').text()).toBe('3')
    await wrapper.get('.vote-btn-arrow.up').trigger('click')
    expect(api.voteOnTiming).toHaveBeenCalledWith(8, 'upvote')
  })

  it.each(['before', 'after'])(
    'keeps other timing votes when initial reads finish %s a vote submission',
    async (readOrder) => {
      const firstRead = deferred()
      const otherRead = deferred()
      const submission = deferred()
      api.getTimingVote.mockImplementation((id) =>
        id === 7 ? firstRead.promise : otherRead.promise
      )
      api.voteOnTiming.mockReturnValue(submission.promise)
      const wrapper = render({
        mode: 'timings',
        movieInfo: { nudity_timings: [timing(7), timing(8)] }
      })
      await wrapper.findAll('.vote-btn-arrow.up')[0].trigger('click')
      const finishReads = async () => {
        firstRead.resolve({ upvotes: 1, downvotes: 2, vote_score: -1 })
        otherRead.resolve({ upvotes: 15, downvotes: 3, vote_score: 12, user_vote: 'downvote' })
        await flushPromises()
      }
      if (readOrder === 'before') await finishReads()
      submission.resolve({ upvotes: 10, downvotes: 1, vote_score: 9 })
      await flushPromises()
      if (readOrder === 'after') await finishReads()
      const cards = wrapper.findAll('.timing-card')
      expect(cards.map((card) => card.get('.vote-score-badge').text())).toEqual(['12', '9'])
      expect(cards[0].get('.vote-btn-arrow.down').classes()).toContain('active')
      expect(cards[1].get('.vote-btn-arrow.up').classes()).toContain('active')
    }
  )

  it('keeps initial vote data when a concurrent vote submission fails', async () => {
    const initial = deferred()
    const submission = deferred()
    api.getTimingVote.mockReturnValue(initial.promise)
    api.voteOnTiming.mockReturnValue(
      submission.promise.then(() => Promise.reject(new Error('Failed')))
    )
    const wrapper = render({ mode: 'timings' })
    await wrapper.get('.vote-btn-arrow.up').trigger('click')
    submission.resolve()
    await flushPromises()
    initial.resolve({ upvotes: 4, downvotes: 1, vote_score: 3, user_vote: 'downvote' })
    await flushPromises()
    expect(wrapper.get('.vote-score-badge').text()).toBe('3')
    expect(wrapper.get('.vote-btn-arrow.down').classes()).toContain('active')
    expect(wrapper.props('notify')).toHaveBeenCalledWith('API error', 5000)
  })

  it('preserves overlay selection while closed and toggles it through one action', async () => {
    window.electronAPI = {}
    const wrapper = render({ mode: 'timings' })
    await flushPromises()
    await wrapper.get('[title="Добавить в оверлей"]').trigger('click')
    expect(wrapper.emitted('overlay-selection').at(-1)).toEqual([[7]])
    await wrapper.setProps({ mode: null })
    await wrapper.setProps({ mode: 'timings' })
    await flushPromises()
    expect(wrapper.get('[title="Удалить из оверлея"]').classes()).toContain('overlay-active')
    await wrapper.get('[title="Удалить из оверлея"]').trigger('click')
    expect(wrapper.emitted('overlay-selection').at(-1)).toEqual([[]])
  })

  it('saves timing edits and refreshes the same movie without closing the scene panel', async () => {
    const wrapper = render({ mode: 'timings' })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Добавить/дополнить тайминг')
      .trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.test-timing-form').exists()).toBe(true))
    const form = wrapper.getComponent({ name: 'MovieTimingFormModal' })
    form.vm.$emit('update:modelValue', '00:20-00:30')
    await flushPromises()
    form.vm.$emit('submit')
    await flushPromises()
    expect(api.submitTiming).toHaveBeenCalledWith('123', '00:20-00:30')
    expect(wrapper.props('refreshMovie')).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('removes its outside-click listener and ignores mutation completions after unmount', async () => {
    const pendingVote = deferred()
    api.voteOnTiming.mockReturnValue(pendingVote.promise)
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const wrapper = render({ mode: 'timings' })
    await flushPromises()
    const listener = add.mock.calls.find(
      ([type, , capture]) => type === 'click' && capture === true
    )[1]
    await wrapper.get('.vote-btn-arrow.up').trigger('click')
    wrapper.unmount()
    wrappers = []
    expect(remove).toHaveBeenCalledWith('click', listener, true)
    pendingVote.resolve({ upvotes: 100, vote_score: 100 })
    await flushPromises()
    expect(wrapper.props('notify')).not.toHaveBeenCalled()
  })
})
