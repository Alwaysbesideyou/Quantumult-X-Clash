import { LiveActivity, Text, Link, HStack, VStack, ZStack, Spacer, gradient, Button, Toggle, DateLabel, TimerIntervalLabel } from 'scripting'
import { reminderLiveActivity, testNotify, widgetReloadAll, CompleteReminderIntent } from "./app_intents"
import { getReminders, formatTime, notification } from "./model"
import { config } from "./config"
import { loadRecords, saveRecords, RecordInfo } from './store'

// 注意：dueDate 用可序列化的字符串保存（ISO），builder 内再转换为 Date。
// 因此属性类型定义为 string | Date
export interface ReminderAttributes {
  title: string
  identifier: string
  dueDate: string | Date
  notes?: string
}

/**
 * 抽取 UI builder 为独立函数 —— 必须传给 new LiveActivity(...) 以及 LiveActivity.from(...)
 */
export function buildReminderUI({ title, identifier, dueDate, notes }: ReminderAttributes) {
  // 兼容 string（序列化后）或 Date
  // const d = dueDate instanceof Date ? dueDate : new Date(String(dueDate))
  const d = new Date(String(dueDate))
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const timeText = `${hh}:${mm}`

  return {
    // 锁屏和非灵动岛设备上的主要内容
    content: (
      <VStack
        alignment={"center"}
        widgetBackground={gradient("linear", {
          colors: ["#2C2C2EFF", "#1C1C1EFF"],
          startPoint: "top",
          endPoint: "bottom",
        })}
      >
        <HStack alignment={"center"} padding={{ leading: 8, top: notes ? 8 : 18, bottom: 0 }}>
          <Spacer />
          <Link url={`x-apple-reminderkit://REMCDReminder/${identifier}`}
            font={20}
            bold={true}
            foregroundStyle="#FFFFFFFF"
            widgetAccentable
          >
            {`${title}`}
          </Link>
          <Spacer />
          <Toggle
            foregroundStyle="white"
            font={22}
            bold={true}
            padding={{ trailing: 16 }}
            title={timeText}
            value={true}
            toggleStyle='button'
            intent={CompleteReminderIntent({ reminderId: identifier, isCompleted: false })} // 触发带参数的 AppIntent
          />
        </HStack>
        <Spacer />
        {notes ? (
          <Text
            frame={{ width: 360 }}
            lineLimit={4}
            truncationMode="tail"
            font={{ name: "subheadline", size: 18 }}
          >
            {notes}
          </Text>
        ) : null}
        <Spacer />
      </VStack >
    ),

    // 灵动岛展开时
    expanded: {
      leading: (
        <Text frame={{ width: 40, height: 40 }}>📝</Text>
      ),
      trailing: (
        <Text frame={{ width: 60, height: 40 }} foregroundStyle="white" font={18} bold={true}>
          {timeText}
        </Text>
      ),
      center: notes ? (
        <Link url={`x-apple-reminderkit://REMCDReminder/${identifier}`}
          font={24}
          frame={{ width: 250, height: 25 }}
          lineLimit={1}
          truncationMode="tail">
          {`${title}`}
        </Link>
      ) : undefined,
      bottom: (
        <ZStack frame={{ width: 360, height: 75 }} alignment="top" >
          {notes ? (
            <Text lineLimit={3} multilineTextAlignment="leading" truncationMode="tail" font={{ name: "subheadline", size: 18 }} padding={{ top: 6 }}>
              {notes}
            </Text>
          ) : (
            <Link url={`x-apple-reminderkit://REMCDReminder/${identifier}`} font={24} lineLimit={2} truncationMode="tail" padding={{ top: -8 }}>
              {`${title}`}
            </Link>
          )}
          <VStack>
            <Spacer />
            <HStack>
              <Spacer />
              <Toggle
                title="已经完成"
                value={true}
                intent={CompleteReminderIntent({ reminderId: identifier, isCompleted: false })} // 触发带参数的 AppIntent
                toggleStyle='button'
              // systemImage={r.isCompleted ? "checkmark.circle.fill" : "circle"}
              />
            </HStack>
          </VStack>
        </ZStack>
      )
    },

    // compactLeading: <Text>📝</Text>,
    compactLeading: <Text
      font={14}
      lineLimit={2}
    >{`${title.length > 5 ? title.slice(0, 5) + "…" : title}`}</Text>,

    compactTrailing: <TimerIntervalLabel
      from={Date.now()}
      to={d.getTime()}
      frame={{ width: 45 }}
      font={15}
      // pauseTime={d.getTime()}
      // countsDown={false}
      showsHours={false} />,

    // minimal: <Text foregroundStyle="white" font={10.5}>{timeText}</Text>
    minimal: <TimerIntervalLabel
      from={Date.now()}
      to={d.getTime()}
      font={15}
      // pauseTime={d.getTime()}
      // countsDown={false}
      showsHours={false}
    />
  }
}

/**
 * 创建一个新的 LiveActivity 实例并启动（每次创建都用 new LiveActivity(buildReminderUI)）
 * 启动后从 activity.activityId 读取系统 id 并保存映射
 */
export async function startActivity(
  title: string,
  identifier: string,
  dueDate: Date,
  notes?: string
) {
  const activity = new LiveActivity<ReminderAttributes>(buildReminderUI)
  // attributes 中把 dueDate 转为 ISO 字符串以确保可序列化
  const attrs: ReminderAttributes = {
    title,
    identifier,
    dueDate: dueDate.toISOString(),
    notes
  }

  const started = await activity.start(attrs)
  notification('[Live]', started ? '实时活动已启动' : '启动失败', config.debug)

  if (started) {
    // activity.activityId 在 start 成功后可用
    const newId = activity.activityId
    if (newId) {
      const records = loadRecords()
      records.push({ reminderId: identifier, liveActivityId: newId })
      saveRecords(records)
    }
  }

  return started
}

/**
 * 根据 liveActivityId 恢复实例并更新（用于替换某个现有 slot 或直接更新某 id）
 */
export async function updateActivityByActivityId(
  liveActivityId: string,
  title: string,
  identifier: string,
  dueDate: Date,
  notes?: string
) {
  const attrs: ReminderAttributes = {
    title,
    identifier,
    dueDate: dueDate.toISOString(),
    notes
  }

  const act = await LiveActivity.from<ReminderAttributes>(liveActivityId, buildReminderUI)
  if (!act) return false
  const ok = await act.update(attrs, {
    // alert: { title: '提醒更新', body: `${title} — 截止时间已更新` }
  })
  if (ok) {
    // 更新本地映射：把该 liveActivityId 对应的 reminderId 替换为当前 identifier
    const records = loadRecords()
    const rec = records.find(r => r.liveActivityId === liveActivityId)
    if (rec) {
      rec.reminderId = identifier
      saveRecords(records)
    } else {
      // 若无旧映射，新增一条
      records.push({ reminderId: identifier, liveActivityId })
      saveRecords(records)
    }
  }
  notification('[Live]', ok ? '实时活动已更新' : '更新失败', config.debug)
  return ok
}

/**
 * 高层更新函数：优先按 identifier 找到已保存的 liveActivityId 并更新；
 * 若记录存在但 from() 返回 null（活动被系统移除），则重建活动并更新映射；
 * 若无记录且活动数已满，则替换（复用）第一个已有的 activity slot。
 */
export async function updateActivity(
  title: string,
  identifier: string,
  dueDate: Date,
  notes?: string
) {
  let records = loadRecords()
  const record = records.find(r => r.reminderId === identifier)

  if (record) {
    // 有映射 -> 尝试恢复并更新
    const act = await LiveActivity.from<ReminderAttributes>(record.liveActivityId, buildReminderUI)
    if (act) {
      const ok = await act.update({
        title,
        identifier,
        dueDate: dueDate.toISOString(),
        notes
      }, {
        // alert: { title: '提醒更新', body: `${title} — 截止时间已更新` }
      })
      notification('[Live]', ok ? '实时活动已更新' : '更新失败', config.debug)
      return ok
    } else {
      // 映射但活动已被系统清除 -> 删除无效映射，然后创建新活动
      records = records.filter(r => r.liveActivityId !== record.liveActivityId)
      saveRecords(records)
      const created = await startActivity(title, identifier, dueDate, notes)
      return created
    }
  }

  // 无映射 -> 需要创建新活动；但若已达上限，则选择替换第一个已有的活动槽
  const existingIds = await LiveActivity.getAllActivitiesIds()
  if (existingIds.length < config.maxLiveActivityCount) {
    const created = await startActivity(title, identifier, dueDate, notes)
    return created
  } else {
    // 选择复用第一个 slot（可根据业务改为最旧/最不重要的）
    const toReplaceId = existingIds[0]
    const ok = await updateActivityByActivityId(toReplaceId, title, identifier, dueDate, notes)
    return ok
  }
}

/**
 * 入口封装：根据本地映射优先更新，否则创建 / 替换
 */
export async function startReminderActivity(title: string, identifier: string, dueDate: Date, notes?: string) {
  try {
    // 先尝试按 identifier 更新（若存在映射则更新）
    const records = loadRecords()
    const record = records.find(r => r.reminderId === identifier)
    if (record) {
      const ok = await updateActivity(title, identifier, dueDate, notes)
      notification('[LiveActivity]', ok ? '实时活动已更新' : '更新失败', config.debug)
      return
    }

    // 无映射 -> 创建或替换（updateActivity 中会处理上限逻辑）
    const ok = await updateActivity(title, identifier, dueDate, notes)
    notification('[LiveActivity]', ok ? '实时活动已启动或已替换' : '启动/替换失败', config.debug)
  } catch (err) {
    notification('[LiveActivity] 启动或更新实时活动失败', String(err), config.debug)
  }
}

/**
 * 可选：根据 identifier 结束活动（并清理映射）
 */
export async function endActivityByIdentifier(identifier: string, dismissTimeInterval = 0) {
  const records = loadRecords()
  const rec = records.find(r => r.reminderId === identifier)
  if (!rec) {
    notification('[Live]', '没有找到对应的实时活动记录', config.debug)
    return false
  }
  const act = await LiveActivity.from<ReminderAttributes>(rec.liveActivityId, buildReminderUI)
  if (!act) {
    // 活动已不存在，清理映射
    const remaining = records.filter(r => r.liveActivityId !== rec.liveActivityId)
    saveRecords(remaining)
    return false
  }
  const ok = await act.end({ title: '已完成', identifier, dueDate: new Date().toISOString(), notes: '' }, { dismissTimeInterval })
  if (ok) {
    const remaining = records.filter(r => r.liveActivityId !== rec.liveActivityId)
    saveRecords(remaining)
    notification('[Live]', '实时活动已结束', config.debug)
  } else {
    notification('[Live]', '结束失败', config.debug)
  }
  return ok
}
