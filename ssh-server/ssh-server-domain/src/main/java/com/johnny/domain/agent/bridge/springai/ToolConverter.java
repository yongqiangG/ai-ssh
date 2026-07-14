/*
 * Decompiled with CFR 0.152.
 */
package com.johnny.domain.agent.bridge.springai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.adk.tools.BaseTool;
import com.google.genai.types.FunctionDeclaration;
import com.google.genai.types.Schema;
import com.google.genai.types.Type;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.function.FunctionToolCallback;

public class ToolConverter {
    private static final Logger logger = LoggerFactory.getLogger(ToolConverter.class);

    public Map<String, ToolMetadata> createToolRegistry(Map<String, BaseTool> tools) {
        HashMap<String, ToolMetadata> registry = new HashMap<String, ToolMetadata>();
        for (BaseTool tool : tools.values()) {
            if (!tool.declaration().isPresent()) continue;
            FunctionDeclaration declaration = (FunctionDeclaration)tool.declaration().get();
            ToolMetadata metadata = new ToolMetadata(tool.name(), tool.description(), declaration);
            registry.put(tool.name(), metadata);
        }
        return registry;
    }

    public Map<String, Object> convertSchemaToSpringAi(Schema schema) {
        HashMap<String, Object> springAiSchema = new HashMap<String, Object>();
        if (schema.type().isPresent()) {
            Type type = (Type)schema.type().get();
            springAiSchema.put("type", this.convertTypeToString(type));
        }
        schema.description().ifPresent(desc -> springAiSchema.put("description", desc));
        if (schema.properties().isPresent()) {
            HashMap properties = new HashMap();
            ((Map)schema.properties().get()).forEach((key, value) -> properties.put(key, this.convertSchemaToSpringAi((Schema)value)));
            springAiSchema.put("properties", properties);
        }
        schema.required().ifPresent(required -> springAiSchema.put("required", required));
        return springAiSchema;
    }

    private String convertTypeToString(Type type) {
        return switch (type.knownEnum()) {
            case STRING -> "string";
            case NUMBER -> "number";
            case INTEGER -> "integer";
            case BOOLEAN -> "boolean";
            case ARRAY -> "array";
            case OBJECT -> "object";
            default -> "string";
        };
    }

    public List<ToolCallback> convertToSpringAiTools(Map<String, BaseTool> tools) {
        ArrayList<ToolCallback> toolCallbacks = new ArrayList<ToolCallback>();
        for (BaseTool tool : tools.values()) {
            if (!tool.declaration().isPresent()) continue;
            FunctionDeclaration declaration = (FunctionDeclaration)tool.declaration().get();
            Function<Map<String, Object>, String> toolFunction = args -> {
                try {
                    logger.debug("Spring AI calling tool '{}'", (Object)tool.name());
                    logger.debug("Raw args from Spring AI: {}", args);
                    logger.debug("Args type: {}", (Object)args.getClass().getName());
                    logger.debug("Args keys: {}", args.keySet());
                    for (Map.Entry entry : args.entrySet()) {
                        logger.debug("  {} -> {} ({})", new Object[]{entry.getKey(), entry.getValue(), entry.getValue().getClass().getName()});
                    }
                    Map<String, Object> processedArgs = this.processArguments((Map<String, Object>)args, declaration);
                    logger.debug("Processed args for ADK: {}", processedArgs);
                    Map result = (Map)tool.runAsync(processedArgs, null).blockingGet();
                    return new ObjectMapper().writeValueAsString((Object)result);
                }
                catch (Exception e) {
                    throw new RuntimeException("Tool execution failed: " + e.getMessage(), e);
                }
            };
            FunctionToolCallback.Builder callbackBuilder = FunctionToolCallback.builder((String)tool.name(), toolFunction).description(tool.description());
            if (declaration.parameters().isPresent()) {
                callbackBuilder.inputType(Map.class);
                Map<String, Object> springAiSchema = this.convertSchemaToSpringAi((Schema)declaration.parameters().get());
                logger.debug("Generated Spring AI schema for {}: {}", (Object)tool.name(), springAiSchema);
                try {
                    String schemaJson = new ObjectMapper().writeValueAsString(springAiSchema);
                    callbackBuilder.inputSchema(schemaJson);
                    logger.debug("Set input schema JSON: {}", (Object)schemaJson);
                }
                catch (Exception e) {
                    logger.error("Error serializing schema to JSON: {}", (Object)e.getMessage(), (Object)e);
                }
            } else if (declaration.parametersJsonSchema().isPresent()) {
                callbackBuilder.inputType(Map.class);
                try {
                    String schemaJson = new ObjectMapper().writeValueAsString(declaration.parametersJsonSchema().get());
                    callbackBuilder.inputSchema(schemaJson);
                    logger.debug("Set input schema JSON from parametersJsonSchema: {}", (Object)schemaJson);
                }
                catch (Exception e) {
                    logger.error("Error serializing parametersJsonSchema to JSON: {}", (Object)e.getMessage(), (Object)e);
                }
            }
            toolCallbacks.add((ToolCallback)callbackBuilder.build());
        }
        return toolCallbacks;
    }

    private Map<String, Object> processArguments(Map<String, Object> args, FunctionDeclaration declaration) {
        if (declaration.parameters().isPresent()) {
            Schema schema = (Schema)declaration.parameters().get();
            if (schema.properties().isPresent()) {
                return this.normalizeArguments(args, ((Map)schema.properties().get()).keySet());
            }
        } else if (declaration.parametersJsonSchema().isPresent()) {
            try {
                Map schemaMap = (Map)new ObjectMapper().convertValue(declaration.parametersJsonSchema().get(), Map.class);
                Object propertiesObj = schemaMap.get("properties");
                if (propertiesObj instanceof Map) {
                    Set<String> expectedParams = ((Map)propertiesObj).keySet();
                    return this.normalizeArguments(args, expectedParams);
                }
            }
            catch (Exception e) {
                logger.warn("Error processing parametersJsonSchema for argument mapping: {}", (Object)e.getMessage());
            }
        }
        return args;
    }

    private Map<String, Object> normalizeArguments(Map<String, Object> args, Set<String> expectedParams) {
        Object singleValue;
        boolean allParamsPresent = expectedParams.stream().allMatch(args::containsKey);
        if (allParamsPresent) {
            return args;
        }
        if (args.size() == 1 && (singleValue = args.values().iterator().next()) instanceof Map) {
            Map nestedArgs = (Map)singleValue;
            boolean allNestedParamsPresent = expectedParams.stream().allMatch(nestedArgs::containsKey);
            if (allNestedParamsPresent) {
                return nestedArgs;
            }
        }
        if (expectedParams.size() == 1) {
            String expectedParam = expectedParams.iterator().next();
            if (args.size() == 1 && !args.containsKey(expectedParam)) {
                Object singleValue2 = args.values().iterator().next();
                return Map.of(expectedParam, singleValue2);
            }
        }
        return args;
    }

    public static class ToolMetadata {
        private final String name;
        private final String description;
        private final FunctionDeclaration declaration;

        public ToolMetadata(String name, String description, FunctionDeclaration declaration) {
            this.name = name;
            this.description = description;
            this.declaration = declaration;
        }

        public String getName() {
            return this.name;
        }

        public String getDescription() {
            return this.description;
        }

        public FunctionDeclaration getDeclaration() {
            return this.declaration;
        }
    }
}

