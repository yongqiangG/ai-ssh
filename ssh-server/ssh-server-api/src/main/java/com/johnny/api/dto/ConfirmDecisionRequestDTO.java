package com.johnny.api.dto;

import lombok.Data;

/**
 * 写操作确认决定请求 DTO（B1 确认门）。
 */
@Data
public class ConfirmDecisionRequestDTO {

    /** confirm_request 事件携带的确认 ID */
    private String confirmId;

    /** true=允许执行；false=拒绝 */
    private boolean allow;
}
