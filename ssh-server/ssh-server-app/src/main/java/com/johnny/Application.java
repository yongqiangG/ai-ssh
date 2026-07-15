package com.johnny;

import org.springframework.beans.factory.annotation.Configurable;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@SpringBootApplication
@Configurable
// 扫描并注册 @ConfigurationProperties 类（如 AgentConfigProperties），绑定 ssh-agent.yml 的 ai.agent.config 段
@ConfigurationPropertiesScan(basePackages = "com.johnny")
public class Application {

    public static void main(String[] args){
        ensureLocalAppDirectory();
        SpringApplication.run(Application.class, args);
    }

    private static void ensureLocalAppDirectory() {
        try {
            Files.createDirectories(Path.of(System.getProperty("user.home"), ".ai-ssh"));
        } catch (IOException e) {
            throw new IllegalStateException("创建本地应用数据目录失败", e);
        }
    }

}
