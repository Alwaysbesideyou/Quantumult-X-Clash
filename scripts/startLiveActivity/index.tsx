import { LiveActivity, Text, VStack, Spacer, Script, Notification } from 'scripting'
import { startReminderActivity } from "./live_activity"
import { notification } from "./model"
import { config } from "./config"

// 启动实时活动
(async () => {
  try {
    const now = new Date()
    const defaultDurationMinutes = 30
    const defaultDueDate = new Date(now.getTime() + defaultDurationMinutes * 60_000)

    // 读取传入参数
    let { title, note, dueDate, identifier } = Script.queryParameters

    // 测试模式：无 title 时自动填充
    const isTestMode = !title
    if (isTestMode) {
      title = '测试实时活动,测试实时活动'
      identifier = `test-activity-${defaultDueDate.getTime()}`
      // note = "这是一个测试实时活动..."
    }

    // 处理 dueDate 类型与有效性
    let dueDateObj: Date
    if (dueDate) {
      dueDateObj = typeof dueDate === 'string' ? new Date(dueDate) : dueDate
      if (isNaN(dueDateObj.getTime())) dueDateObj = defaultDueDate
    } else {
      dueDateObj = defaultDueDate
    }

    // 如果传入的日期早于当前时间，则用默认值
    if (dueDateObj < now) { dueDateObj = defaultDueDate }

    notification('[LiveActivity] 开始启动实时活动', JSON.stringify(Script.queryParameters), config.debug)
    await startReminderActivity(title!, identifier!, dueDateObj, note)
    const activityIds = await LiveActivity.getAllActivitiesIds()
    notification('[LiveActivity] 启动实时活动成功', `ID: ${activityIds.join(', ')}, 活动数量: ${activityIds.length}`, config.debug)
    Safari.openURL('shortcuts://run-shortcut?name=toDesktop')
  } catch (err) {
    notification('[LiveActivity] 启动实时活动异常:', String(err), config.debug)
  }
})()
