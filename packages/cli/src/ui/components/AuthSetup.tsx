/**
 * AuthSetup 组件 - 交互式 CodingPlan 账户设置
 *
 * 参考 iFlow CLI 的交互方式：
 * 1. 显示厂商列表，上下选择
 * 2. 输入 API Key
 * 3. 如果是自定义，输入 Base URL
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { getColors, toInkColor } from "../theme/index.js";
import type { ProviderPreset } from "../../auth/types.js";

// ============================================================================
// 类型定义
// ============================================================================

interface AuthSetupProps {
  /** 厂商列表 */
  providers: ProviderPreset[];
  /** 完成回调 */
  onComplete: (result: AuthSetupResult) => void;
  /** 取消回调 */
  onCancel: () => void;
}

export interface AuthSetupResult {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  alias?: string;
}

// ============================================================================
// 步骤枚举
// ============================================================================

type SetupStep = "provider" | "apiKey" | "baseUrl" | "alias" | "confirm";

// ============================================================================
// AuthSetup 组件
// ============================================================================

export const AuthSetup: React.FC<AuthSetupProps> = ({
  providers,
  onComplete,
  onCancel,
}) => {
  const colors = getColors();

  // 状态
  const [step, setStep] = useState<SetupStep>("provider");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<ProviderPreset | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [alias, setAlias] = useState("");

  // 选择厂商
  const handleProviderSelect = useCallback((index: number) => {
    const provider = providers[index];
    if (provider) {
      setSelectedProvider(provider);
      setSelectedIndex(index);
      if (provider.id === "custom") {
        setStep("baseUrl");
      } else {
        setStep("apiKey");
      }
    }
  }, [providers]);

  // 键盘输入处理
  useInput(
    useCallback(
      (input, key) => {
        // 厂商选择步骤
        if (step === "provider") {
          if (key.upArrow) {
            setSelectedIndex((prev) => (prev - 1 + providers.length) % providers.length);
          } else if (key.downArrow) {
            setSelectedIndex((prev) => (prev + 1) % providers.length);
          } else if (key.return) {
            handleProviderSelect(selectedIndex);
          } else if (key.escape) {
            onCancel();
          } else {
            // 数字键快速选择
            const num = parseInt(input, 10);
            if (num >= 1 && num <= providers.length) {
              handleProviderSelect(num - 1);
            }
          }
          return;
        }

        // 其他步骤由 TextInput 处理
        if (key.escape) {
          // 返回上一步
          if (step === "apiKey") {
            setStep("provider");
            setApiKey("");
          } else if (step === "baseUrl") {
            setStep("provider");
            setBaseUrl("");
          } else if (step === "alias") {
            setStep(selectedProvider?.id === "custom" ? "baseUrl" : "apiKey");
            setAlias("");
          } else if (step === "confirm") {
            setStep("alias");
          }
        }
      },
      [step, selectedIndex, providers, selectedProvider, handleProviderSelect, onCancel],
    ),
  );

  // 渲染厂商选择
  const renderProviderSelection = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={toInkColor(colors.text.accent)}>
          选择 CodingPlan 厂商
        </Text>
      </Box>

      {providers.map((provider, index) => (
        <Box key={provider.id}>
          <Text
            color={
              index === selectedIndex
                ? toInkColor(colors.text.accent)
                : toInkColor(colors.text.muted)
            }
            bold={index === selectedIndex}
            inverse={index === selectedIndex}
          >
            {index === selectedIndex ? "> " : "  "}
            {String(index + 1).padStart(2, " ")}.
          </Text>
          <Text
            bold={index === selectedIndex}
            color={
              index === selectedIndex
                ? toInkColor(colors.text.primary)
                : toInkColor(colors.text.secondary)
            }
          >
            {" "}
            {provider.name}
          </Text>
          <Text dimColor>
            {" "}
            ({provider.models.length} 款模型, {provider.protocol === "both" ? "OpenAI + Anthropic" : provider.protocol})
          </Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>  上下键选择 | 数字键快速选择 | 回车确认 | Esc 取消</Text>
      </Box>
    </Box>
  );

  // 渲染 API Key 输入
  const renderApiKeyInput = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={toInkColor(colors.text.accent)}>
          配置 {selectedProvider?.name}
        </Text>
      </Box>

      <Box>
        <Text>请输入 API Key：</Text>
      </Box>

      <Box marginLeft={2}>
        <Text color={toInkColor(colors.text.accent)}>{">"} </Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          onSubmit={() => {
            if (apiKey.trim()) {
              if (selectedProvider?.id === "custom") {
                setStep("alias");
              } else {
                setStep("alias");
              }
            }
          }}
          placeholder="输入 API Key..."
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>  按回车确认 | Esc 返回</Text>
      </Box>
    </Box>
  );

  // 渲染 Base URL 输入
  const renderBaseUrlInput = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={toInkColor(colors.text.accent)}>
          自定义 API 服务
        </Text>
      </Box>

      <Box>
        <Text>请输入 Base URL：</Text>
      </Box>

      <Box marginLeft={2}>
        <Text color={toInkColor(colors.text.accent)}>{">"} </Text>
        <TextInput
          value={baseUrl}
          onChange={setBaseUrl}
          onSubmit={() => {
            if (baseUrl.trim()) {
              setStep("apiKey");
            }
          }}
          placeholder="https://api.example.com/v1"
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>  按回车确认 | Esc 返回</Text>
      </Box>
    </Box>
  );

  // 渲染别名输入
  const renderAliasInput = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={toInkColor(colors.text.accent)}>
          设置账户别名
        </Text>
      </Box>

      <Box>
        <Text>请输入别名（可选，直接回车跳过）：</Text>
      </Box>

      <Box marginLeft={2}>
        <Text color={toInkColor(colors.text.accent)}>{">"} </Text>
        <TextInput
          value={alias}
          onChange={setAlias}
          onSubmit={() => {
            setStep("confirm");
          }}
          placeholder={selectedProvider?.name || "我的账户"}
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>  按回车确认 | Esc 返回</Text>
      </Box>
    </Box>
  );

  // 渲染确认
  const renderConfirm = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={toInkColor(colors.text.accent)}>
          确认配置
        </Text>
      </Box>

      <Box flexDirection="column" marginLeft={2}>
        <Box>
          <Text dimColor>厂商: </Text>
          <Text bold>{selectedProvider?.name}</Text>
        </Box>
        <Box>
          <Text dimColor>API Key: </Text>
          <Text>{apiKey.slice(0, 8)}...{apiKey.slice(-4)}</Text>
        </Box>
        {baseUrl && (
          <Box>
            <Text dimColor>Base URL: </Text>
            <Text>{baseUrl}</Text>
          </Box>
        )}
        {alias && (
          <Box>
            <Text dimColor>别名: </Text>
            <Text>{alias}</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>  按回车确认添加 | Esc 返回修改</Text>
      </Box>
    </Box>
  );

  // 处理确认提交
  useInput(
    useCallback(
      (input, key) => {
        if (step === "confirm" && key.return) {
          onComplete({
            provider: selectedProvider?.id || "",
            apiKey: apiKey.trim(),
            baseUrl: baseUrl.trim() || undefined,
            alias: alias.trim() || undefined,
          });
        }
      },
      [step, selectedProvider, apiKey, baseUrl, alias, onComplete],
    ),
  );

  // 渲染当前步骤
  const renderStep = () => {
    switch (step) {
      case "provider":
        return renderProviderSelection();
      case "apiKey":
        return renderApiKeyInput();
      case "baseUrl":
        return renderBaseUrlInput();
      case "alias":
        return renderAliasInput();
      case "confirm":
        return renderConfirm();
      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={toInkColor(colors.ui.border)} paddingX={1}>
      {renderStep()}
    </Box>
  );
};

export default AuthSetup;
