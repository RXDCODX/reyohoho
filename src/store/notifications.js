import { defineStore } from 'pinia'
import { useAuthStore } from '@/store/auth'
import { accountCapabilities } from '@/api/accountCapabilities'
import {
  getNotifications,
  getUnreadNotificationsCount,
  markNotificationsAsRead,
  deleteNotification
} from '@/api/notifications'

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    notifications: [],
    unreadCount: 0,
    loading: false,
    error: null,
    lastFetchTime: null
  }),

  actions: {
    async fetchNotifications() {
      const token = useAuthStore().token
      if (!accountCapabilities(useAuthStore()).notifications) {
        this.reset()
        return
      }
      this.loading = true
      this.error = null

      try {
        const data = await getNotifications()
        if (useAuthStore().token !== token) return
        this.notifications = data.notifications || []
        this.unreadCount = data.unread_count || 0
        this.lastFetchTime = Date.now()
      } catch (error) {
        if (useAuthStore().token !== token) return
        this.error = error.response?.data?.error || 'Ошибка загрузки уведомлений'
        console.error('Error fetching notifications:', error)
      } finally {
        if (useAuthStore().token === token) this.loading = false
      }
    },

    async fetchUnreadCount() {
      const token = useAuthStore().token
      if (!accountCapabilities(useAuthStore()).notifications) {
        this.reset()
        return
      }
      try {
        const data = await getUnreadNotificationsCount()
        if (useAuthStore().token !== token) return
        this.unreadCount = data.unread_count || 0
      } catch (error) {
        console.error('Error fetching unread count:', error)
      }
    },

    async markAsRead(notificationIds = null) {
      const token = useAuthStore().token
      try {
        await markNotificationsAsRead(notificationIds)
        if (useAuthStore().token !== token) return

        if (notificationIds) {
          this.notifications.forEach((notification) => {
            if (notificationIds.includes(notification.id)) {
              notification.is_read = true
              notification.read_at = new Date().toISOString()
            }
          })
          this.unreadCount = Math.max(0, this.unreadCount - notificationIds.length)
        } else {
          this.notifications.forEach((notification) => {
            notification.is_read = true
            notification.read_at = new Date().toISOString()
          })
          this.unreadCount = 0
        }
      } catch (error) {
        if (useAuthStore().token !== token) throw error
        this.error = error.response?.data?.error || 'Ошибка при отметке уведомлений'
        console.error('Error marking notifications as read:', error)
        throw error
      }
    },

    async deleteNotification(notificationId) {
      const token = useAuthStore().token
      try {
        await deleteNotification(notificationId)
        if (useAuthStore().token !== token) return

        const notification = this.notifications.find((n) => n.id === notificationId)
        if (notification && !notification.is_read) {
          this.unreadCount = Math.max(0, this.unreadCount - 1)
        }

        this.notifications = this.notifications.filter((n) => n.id !== notificationId)
      } catch (error) {
        if (useAuthStore().token !== token) throw error
        this.error = error.response?.data?.error || 'Ошибка удаления уведомления'
        console.error('Error deleting notification:', error)
        throw error
      }
    },

    clearError() {
      this.error = null
    },

    reset() {
      this.notifications = []
      this.unreadCount = 0
      this.loading = false
      this.error = null
      this.lastFetchTime = null
    }
  },

  getters: {
    unreadNotifications: (state) => {
      return state.notifications.filter((notification) => !notification.is_read)
    },

    getNotificationsByType: (state) => (type) => {
      return state.notifications.filter((notification) => notification.type === type)
    },

    hasUnreadNotifications: (state) => {
      return state.unreadCount > 0
    }
  }
})
