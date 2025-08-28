const storageKey = "liveActivity.records"

export type RecordInfo = {
  reminderId: string
  liveActivityId: string
}

export function loadRecords() {
  return Storage.get<RecordInfo[]>(storageKey) ?? []
}

export function saveRecords(value: RecordInfo[]) {
  Storage.set(storageKey, value)
}

export function deleteRecords(value: RecordInfo[]) {
  Storage.remove(storageKey)
}
