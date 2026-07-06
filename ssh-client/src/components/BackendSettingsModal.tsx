import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useBackendStore } from "../stores/backendStore";
// CSS Modules：import 的是一个「类名映射对象」，modalStyles.overlay 实际是编译后带
// hash 的类名（如 overlay_x7f3a），保证样式只作用于本组件，不会全局污染。
// 类比后端：相当于给每个模块的 Bean 名加了包前缀，避免命名冲突。
import modalStyles from "./sshConnectionModal.module.css";

/**
 * 组件的「方法签名」：父组件必须按此结构传参（编译期校验，类似强类型的接口契约）。
 *
 * 【引申：受控组件模式】弹窗自己不持有"开/关"状态，而是由父组件通过 open 控制、
 * 通过 onClose 回调请求关闭——组件对自身可见性只有"建议权"没有"决定权"。
 * 这类似后端把状态外置：组件保持无状态化，父组件成为唯一事实来源（Single Source of Truth），
 * 多处复用同一弹窗时不会出现状态不一致。
 */
interface BackendSettingsModalProps {
  /** 是否显示弹窗（由父组件控制） */
  open: boolean;
  /** 请求关闭时的回调（点遮罩 / 关闭按钮 / 取消 / 保存成功后都会调用） */
  onClose: () => void;
}

/**
 * 后端服务地址设置弹窗。
 *
 * 开发环境留空走 vite 代理；生产环境填写实际地址（如 http://192.168.1.10:8091）。
 * 地址与测试状态由 {@link useBackendStore} 管理，底层持久化到 localStorage。
 *
 * 【引申：React 组件的本质】这是一个会被"反复整体调用"的函数：任何订阅的状态变化
 * 都会让 React 重新执行整个函数体（称为重渲染 re-render），拿到新的 UI 描述后
 * 与上一次做 diff，只把差异部分写入真实 DOM。所以函数体内的普通变量（如下面的
 * isTesting）每次渲染都会重新计算——这是特性不是浪费，理解"函数会反复执行"是
 * 理解所有 Hook 的前提。
 *
 * 【引申：分层对照】本组件相当于 Controller（只做交互与展示），backendStore 相当于
 * Service（状态与流程编排），api/request.ts 相当于基础设施层（HTTP + 持久化）。
 * 组件内没有任何 fetch 与业务逻辑，全部委托给 store——与后端的分层洁癖一致。
 */
export default function BackendSettingsModal({
  open,
  onClose, // 参数位置的 { open, onClose } 是解构赋值：直接从 props 对象里取字段
}: BackendSettingsModalProps) {
  // ---- 订阅全局 store（Zustand）----
  // useBackendStore(selector) 表示"订阅 store 中的某个切片"：该切片变化 → 本组件重渲染。
  // 拆成多行分别订阅而非一次取整个对象，是为了精确订阅——只有真正用到的字段变化才
  // 触发重渲染。类比后端：按需注入单个依赖，而不是注入整个 ApplicationContext。
  const setBaseUrl = useBackendStore((s) => s.setBaseUrl);
  const testConnection = useBackendStore((s) => s.testConnection);
  const resetTest = useBackendStore((s) => s.resetTest);
  const testStatus = useBackendStore((s) => s.testStatus); // 状态机：idle|testing|success|fail
  const testMessage = useBackendStore((s) => s.testMessage); // 失败时的错误信息

  // ---- 本地草稿状态 ----
  // useState 返回 [当前值, setter]。url 是只属于本组件实例的"表单草稿"，
  // 与 store 里已保存的 baseUrl 刻意分离：用户编辑的是草稿，点「保存」才落库。
  // 类比后端：表单 DTO 与持久化实体分离——不能每敲一个字符就持久化一次。
  // 【引申】调用 setUrl(x) 并不是简单赋值，而是"通知 React 状态变了，请重新执行
  // 本函数"；下一次执行时 useState 会返回新值。这就是输入框能实时刷新的机制。
  const [url, setUrl] = useState("");

  // ---- 副作用：弹窗每次打开时初始化 ----
  // useEffect(fn, deps)：deps 数组里任一值相比上次渲染发生变化时，渲染完成后执行 fn。
  // 类比后端：约等于一个监听 open 字段变化的事件回调（而非构造器——组件函数本身
  // 每次渲染都执行，useEffect 才是"只在特定时机执行"的地方）。
  useEffect(() => {
    if (open) {
      // 打开时回显当前已保存地址，并清掉上次的测试结果
      // getState() 是绕过订阅机制直接读一次 store 的瞬时值（类似直接调 getter
      // 而非注册监听）——这里只需要"打开这一刻"的值，不需要跟随后续变化。
      setUrl(useBackendStore.getState().baseUrl);
      resetTest();
    }
    // 依赖数组写 [open, resetTest]：open 决定触发时机；resetTest 按 lint 规则
    // （react-hooks/exhaustive-deps）必须声明，Zustand 保证其引用稳定，实际不会多触发。
  }, [open, resetTest]);

  // 卫语句：关闭态什么都不渲染（返回 null 即"无 DOM"）。
  // 注意它必须放在所有 Hook 调用之后——React 靠"调用顺序"识别每个 Hook，
  // 若提前 return 导致某次渲染少调了 Hook，顺序错位会直接报错（Hooks 规则）。
  if (!open) return null;

  // 普通派生变量：每次渲染重新计算即可，无需也不应放进 state。
  // 【引申】"能从现有 state 算出来的值就不要另存一份"——存两份必然面临同步问题，
  // 与数据库"不存冗余可推导列"是同一个道理。
  const isTesting = testStatus === "testing";

  /** 保存：把草稿写入 store（内部同步写 localStorage），然后关闭弹窗 */
  const save = () => {
    setBaseUrl(url);
    onClose();
  };

  // ---- JSX：UI 声明 ----
  // JSX 看着像 HTML，实际是语法糖，编译成函数调用（React.createElement）。
  // 差异点：class 要写 className（class 是 JS 保留字）；{} 内可嵌任意 JS 表达式；
  // 事件名驼峰式（onMouseDown 而非 onmousedown）。
  return (
    // 遮罩层：点击任意位置关闭弹窗
    <div className={modalStyles.overlay} onMouseDown={onClose}>
      <div
        className={modalStyles.dialog}
        style={{ width: 420 }} // 内联样式传对象；数字自动补 px
        // 阻止事件冒泡：DOM 事件默认从内层元素向外层传播（类似异常向上抛），
        // 不拦截的话点击对话框内部也会冒泡到遮罩层触发 onClose。
        // 两行配合实现"点外部关闭、点内部不关"。
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog" // 无障碍(a11y)标注：告知屏幕阅读器这是对话框
        aria-modal="true"
      >
        <div className={modalStyles.header}>
          <span className={modalStyles.headerTitle}>后端服务地址</span>
          {/* JSX 中的注释要写成 {\/* *\/} 形式；type="button" 防止按钮在 form 内默认触发提交 */}
          <button className="icon-btn" onClick={onClose} title="关闭" type="button">
            <Icon name="close" />
          </button>
        </div>
        <div className={modalStyles.body}>
          <label className={modalStyles.field}>
            <span className={modalStyles.label}>服务地址</span>
            {/*
              受控输入框：value 由 state 驱动，onChange 更新 state。
              数据流是单向闭环：state → 渲染出 value → 用户输入触发 onChange →
              setUrl 更新 state → 重渲染。输入框永远只显示 state 的值，
              所以"界面显示什么"完全由数据决定，方便测试与回放。
            */}
            <input
              className="input"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                // 地址一旦编辑，上次的测试结果即陈旧数据，立刻清回 idle，
                // 避免"改了地址还显示旧的连接成功"误导用户。
                resetTest();
              }}
              placeholder="留空走开发代理；生产填 http://host:8091"
              autoFocus
            />
          </label>
          <div className={modalStyles.hint}>
            开发环境留空即可（vite 代理 /api → localhost:8091）；生产环境填写后端实际地址，保存后即时生效并持久化。
          </div>

          <div className={modalStyles.testRow}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isTesting} // 测试进行中禁用按钮，防止重复请求
              // 传入的是输入框草稿值而非已保存值——用户可以"先测再存"。
              // testConnection 是 async 函数，void 前缀显式丢弃 Promise，表示
              // "发起后不在此等待"；结果通过 store 的 testStatus 状态机异步回流，
              // 驱动下方三态渲染。最终这个请求打到后端 PingController 的 GET /api/ping。
              onClick={() => void testConnection(url)}
            >
              {/* 三元表达式做条件文案：JSX 的 {} 里只能放表达式，不能放 if 语句 */}
              {isTesting ? "测试中…" : "测试连接"}
            </button>
            {/*
              条件渲染惯用法：`条件 && <元素>`——条件为 false 时整个表达式为 false，
              React 会忽略不渲染。下面两块分别对应状态机的 success / fail 分支，
              testing 态则体现在按钮文案上，idle 态什么都不显示。
            */}
            {testStatus === "success" && (
              <span
                // 模板字符串拼接多个 CSS Modules 类名
                className={`${modalStyles.testResult} ${modalStyles.testSuccess}`}
              >
                <Icon name="check" size={14} />
                连接成功
              </span>
            )}
            {testStatus === "fail" && (
              <span
                className={`${modalStyles.testResult} ${modalStyles.testFail}`}
              >
                <Icon name="close" size={14} />
                {/* || 兜底：testMessage 为 null/空串时显示通用文案 */}
                {testMessage || "连接失败"}
              </span>
            )}
          </div>
        </div>
        <div className={modalStyles.footer}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            取消
          </button>
          {/* onClick={save} 传函数引用；写成 onClick={save()} 就成了渲染时立即执行，常见新手坑 */}
          <button type="button" className="btn" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
