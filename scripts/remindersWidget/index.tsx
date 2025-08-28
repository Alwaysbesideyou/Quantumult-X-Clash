import { Widget, Script, LiveActivity } from "scripting"
import { getReminders, notification } from "./model"
import { config } from "./config"
import { loadRecords, saveRecords, RecordInfo } from './store'

(async () => {
    const allLiveActivityID = await LiveActivity.getAllActivitiesIds()
    const liveActivity = await import("./live_activity") // 动态导入
    const records = loadRecords()
    console.log("[Widget] 已加载实时活动数量:", allLiveActivityID.length, "记录数量:", records.length)
    const reminders = await getReminders(10, false)
    notification(`[Widget] 获取提醒数量: ${reminders.length} 记录数量: ${records.length}`, `已存在实时活动数量: ${allLiveActivityID.length}`, config.debug)
    for (const r of reminders) {
        if (r.identifier === records.at(0)?.reminderId) {
            notification("[LiveActivity] 已存在实时活动:", r.title, config.debug)
            const now = new Date()
            const defaultDueDate = new Date(now.getTime() + 30 * 60_000)
            let dueDateObj: Date
            if (r.dueDateComponents?.date) {
                dueDateObj = typeof r.dueDateComponents.date === 'string' ? new Date(r.dueDateComponents.date) : r.dueDateComponents.date
                if (isNaN(dueDateObj.getTime())) dueDateObj = defaultDueDate
            } else {
                dueDateObj = defaultDueDate
            }
            if (dueDateObj < now) { dueDateObj = defaultDueDate } // 由于 TimerIntervalLabel 参数需要时间未到
            liveActivity.updateActivity(r.identifier, r.title, dueDateObj, r.notes ?? '')
        } else notification("[LiveActivity] 不存在实时活动:", r.title, config.debug)
    }

    // Widget.preview({ family: "systemSmall" })
    // Script.exit()
})()

