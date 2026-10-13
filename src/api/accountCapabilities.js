export const accountCapabilities = (auth) => ({
  rated: Boolean(auth.token && !auth.isWorkerSession),
  sharing: Boolean(auth.token && !auth.isWorkerSession),
  notifications: Boolean(auth.token && !auth.isWorkerSession)
})
