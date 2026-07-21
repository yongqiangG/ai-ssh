package com.johnny.domain.agent.service.tools;

import java.util.List;
import java.util.regex.Pattern;

/**
 * 命令读写分类器（确认门的规则通道）。
 * <p>
 * 判定「是否写操作」采用双通道取 OR（B1 决议）：本规则库命中 <b>或</b> 模型自评 intent=write，
 * 即需用户确认。规则挡模型漏报，自评挡规则漏项——漏判需同时骗过两者；
 * 更底线的 8 条硬黑名单（{@code SshExecuteAdkTool.BLOCKED}）始终前置直接拦截。
 */
public final class CommandClassifier {

    private CommandClassifier() {
    }

    /** 写模式规则库：文件/进程/服务/包管理/权限/网络配置/重定向写入等变更类命令 */
    private static final List<Pattern> WRITE_PATTERNS = List.of(
            // 文件系统变更
            Pattern.compile("\\b(rm|mv|cp|dd|shred|truncate|unlink|rmdir|mkdir|ln|touch)\\b"),
            Pattern.compile("\\b(chmod|chown|chgrp|chattr|setfacl)\\b"),
            Pattern.compile("\\b(mount|umount|swapon|swapoff|mkswap|parted|fdisk|resize2fs)\\b"),
            // 重定向/原地写入
            Pattern.compile("(^|[^>])>{1,2}\\s*\\S"),
            Pattern.compile("\\btee\\b"),
            Pattern.compile("\\bsed\\s+(-[a-z]*i|--in-place)"),
            // 进程/服务/系统状态
            Pattern.compile("\\b(kill|pkill|killall)\\b"),
            Pattern.compile("\\bsystemctl\\s+(start|stop|restart|reload|enable|disable|mask|unmask)\\b"),
            Pattern.compile("\\bservice\\s+\\S+\\s+(start|stop|restart|reload)\\b"),
            Pattern.compile("\\bsysctl\\s+-w\\b"),
            // 包管理安装/卸载
            Pattern.compile("\\b(yum|dnf|apt|apt-get|zypper|pacman)\\b.*\\b(install|remove|erase|purge|upgrade|update)\\b"),
            Pattern.compile("\\b(pip3?|npm|yarn|gem|cargo)\\s+(install|uninstall|remove|add)\\b"),
            // 用户/权限/计划任务
            Pattern.compile("\\b(useradd|userdel|usermod|groupadd|groupdel|passwd|visudo)\\b"),
            Pattern.compile("\\bcrontab\\s+(-r|-e|\\S+\\.cron|[^-])"),
            // 网络/防火墙配置
            Pattern.compile("\\b(iptables|nft|firewall-cmd|ufw)\\b"),
            Pattern.compile("\\bip\\s+(link|addr|route)\\s+(add|del|set|change|replace|flush)\\b"),
            // git 等版本库写操作（远端服务器上改代码属变更）
            Pattern.compile("\\bgit\\s+(push|reset|checkout|clean|rebase|merge|commit|stash\\s+drop)\\b")
    );

    /**
     * 规则通道：命令是否命中写模式。
     */
    public static boolean matchesWritePattern(String command) {
        if (command == null || command.isBlank()) {
            return false;
        }
        for (Pattern p : WRITE_PATTERNS) {
            if (p.matcher(command).find()) {
                return true;
            }
        }
        return false;
    }

    /**
     * 双通道合成：规则命中 OR 模型自评 write → 需要用户确认。
     *
     * @param command 待执行命令
     * @param intent  模型自评意图（"read"/"write"；null/其他值时仅靠规则通道）
     */
    public static boolean needsConfirm(String command, String intent) {
        return "write".equalsIgnoreCase(intent) || matchesWritePattern(command);
    }
}
