# server 端 GraalVM native-image 编译

来源：260722 启动提速 grill（Q4 裁定本期做 CDS，native 入池）。

## 问题

sidecar 形态下 JVM 冷启动是体验瓶颈。CDS 后仍余数秒；native-image 可到 <1s 启动 + 内存减半，是单体形态的终极答案。

## 草图与已知雷区

- Spring Boot 3.4 官方支持 `native:compile`；但 MyBatis native 支持一般（mapper 动态代理需 reflection hints）、JSch/BouncyCastle 反射、vendored MySpringAI/ADK 桥接的动态代理均需逐一配 hints
- CI 构建时间 +15min 级；Windows 需 MSVC 工具链（workflow 已有 BuildTools 可复用）
- 采纳时机建议：功能进入平台期、启动体验仍被抱怨时再投入；先做 dev profile 冒烟（H2 + 全 Controller + 一次 Tool 调用闭环）验证可行性再全量
