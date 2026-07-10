package com.johnny;

import org.springframework.beans.factory.annotation.Configurable;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@Configurable
// 扫描并注册 @ConfigurationProperties 类（如 AiProperties），绑定 application*.yml 的 ai.* 段
@ConfigurationPropertiesScan(basePackages = "com.johnny")
public class Application {

    public static void main(String[] args){
        SpringApplication.run(Application.class);
    }

}
