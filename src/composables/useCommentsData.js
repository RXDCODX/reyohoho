import { ref } from 'vue'
import { isRequestCanceled } from '@/utils/requestCancellation'

export const useCommentsData = ({ movieId, fetchComments }) => {
  const comments = ref([])
  const commentsLoading = ref(false)
  const commentsLoadError = ref('')
  let activeController = null

  const loadCommentsData = async () => {
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    commentsLoading.value = true
    commentsLoadError.value = ''
    try {
      const loaded = await fetchComments(movieId(), { signal: controller.signal })
      if (activeController !== controller || controller.signal.aborted) return null
      comments.value = loaded || []
      return true
    } catch (error) {
      if (activeController !== controller || controller.signal.aborted || isRequestCanceled(error))
        return null
      commentsLoadError.value = 'Не удалось загрузить комментарии.'
      return false
    } finally {
      if (activeController === controller) {
        activeController = null
        commentsLoading.value = false
      }
    }
  }

  const cancelCommentsLoad = () => {
    activeController?.abort()
    activeController = null
    commentsLoading.value = false
  }

  return {
    comments,
    commentsLoading,
    commentsLoadError,
    loadCommentsData,
    cancelCommentsLoad
  }
}
