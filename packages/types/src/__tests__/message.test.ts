/**
 * @sacode/types - Message Types Unit Tests
 */

import { describe, it, expect } from "vitest";
import {
  type MessageContent,
  type TextContent,
  type ImageContent,
  type AudioContent,
  type VideoContent,
  type FileContent,
  type LocationContent,
  type StickerContent,
  isTextContent,
  isImageContent,
  isAudioContent,
  isVideoContent,
  isFileContent,
  isLocationContent,
  isStickerContent,
} from "../message.js";

describe("Message Types", () => {
  describe("Type Guards", () => {
    describe("isTextContent", () => {
      it("should return true for text content", () => {
        const content: MessageContent = { type: "text", text: "Hello" };
        expect(isTextContent(content)).toBe(true);
      });

      it("should return false for non-text content", () => {
        const content: MessageContent = { type: "image", url: "https://example.com/image.png" };
        expect(isTextContent(content)).toBe(false);
      });

      it("should narrow type correctly", () => {
        const content: MessageContent = { type: "text", text: "Hello", markdown: true };
        if (isTextContent(content)) {
          expect(content.text).toBe("Hello");
          expect(content.markdown).toBe(true);
        }
      });
    });

    describe("isImageContent", () => {
      it("should return true for image content with url", () => {
        const content: MessageContent = { type: "image", url: "https://example.com/image.png" };
        expect(isImageContent(content)).toBe(true);
      });

      it("should return true for image content with base64", () => {
        const content: MessageContent = { type: "image", base64: "base64data" };
        expect(isImageContent(content)).toBe(true);
      });

      it("should return true for image content with path", () => {
        const content: MessageContent = { type: "image", path: "/path/to/image.png" };
        expect(isImageContent(content)).toBe(true);
      });

      it("should return false for non-image content", () => {
        const content: MessageContent = { type: "text", text: "Hello" };
        expect(isImageContent(content)).toBe(false);
      });

      it("should narrow type correctly with optional fields", () => {
        const content: MessageContent = {
          type: "image",
          url: "https://example.com/image.png",
          width: 800,
          height: 600,
          size: 102400,
          mimeType: "image/png",
          caption: "A test image",
        };
        if (isImageContent(content)) {
          expect(content.url).toBe("https://example.com/image.png");
          expect(content.width).toBe(800);
          expect(content.height).toBe(600);
          expect(content.caption).toBe("A test image");
        }
      });
    });

    describe("isAudioContent", () => {
      it("should return true for audio content", () => {
        const content: MessageContent = { type: "audio", url: "https://example.com/audio.mp3" };
        expect(isAudioContent(content)).toBe(true);
      });

      it("should return false for non-audio content", () => {
        const content: MessageContent = { type: "text", text: "Hello" };
        expect(isAudioContent(content)).toBe(false);
      });

      it("should narrow type correctly with optional fields", () => {
        const content: MessageContent = {
          type: "audio",
          url: "https://example.com/audio.mp3",
          duration: 120,
          size: 204800,
          mimeType: "audio/mpeg",
          filename: "audio.mp3",
          transcription: "Transcribed text",
        };
        if (isAudioContent(content)) {
          expect(content.duration).toBe(120);
          expect(content.transcription).toBe("Transcribed text");
        }
      });
    });

    describe("isVideoContent", () => {
      it("should return true for video content", () => {
        const content: MessageContent = { type: "video", url: "https://example.com/video.mp4" };
        expect(isVideoContent(content)).toBe(true);
      });

      it("should return false for non-video content", () => {
        const content: MessageContent = { type: "text", text: "Hello" };
        expect(isVideoContent(content)).toBe(false);
      });

      it("should narrow type correctly with optional fields", () => {
        const content: MessageContent = {
          type: "video",
          url: "https://example.com/video.mp4",
          duration: 300,
          width: 1920,
          height: 1080,
          size: 10485760,
          mimeType: "video/mp4",
          caption: "A test video",
          thumbnailUrl: "https://example.com/thumbnail.jpg",
        };
        if (isVideoContent(content)) {
          expect(content.duration).toBe(300);
          expect(content.caption).toBe("A test video");
          expect(content.thumbnailUrl).toBe("https://example.com/thumbnail.jpg");
        }
      });
    });

    describe("isFileContent", () => {
      it("should return true for file content", () => {
        const content: MessageContent = { type: "file", filename: "document.pdf" };
        expect(isFileContent(content)).toBe(true);
      });

      it("should return false for non-file content", () => {
        const content: MessageContent = { type: "text", text: "Hello" };
        expect(isFileContent(content)).toBe(false);
      });

      it("should narrow type correctly with required filename", () => {
        const content: MessageContent = {
          type: "file",
          url: "https://example.com/document.pdf",
          filename: "document.pdf",
          size: 102400,
          mimeType: "application/pdf",
        };
        if (isFileContent(content)) {
          expect(content.filename).toBe("document.pdf");
          expect(content.size).toBe(102400);
        }
      });
    });

    describe("isLocationContent", () => {
      it("should return true for location content", () => {
        const content: MessageContent = {
          type: "location",
          latitude: 39.9042,
          longitude: 116.4074,
        };
        expect(isLocationContent(content)).toBe(true);
      });

      it("should return false for non-location content", () => {
        const content: MessageContent = { type: "text", text: "Hello" };
        expect(isLocationContent(content)).toBe(false);
      });

      it("should narrow type correctly with required coordinates", () => {
        const content: MessageContent = {
          type: "location",
          latitude: 39.9042,
          longitude: 116.4074,
          name: "Beijing",
          address: "China",
        };
        if (isLocationContent(content)) {
          expect(content.latitude).toBe(39.9042);
          expect(content.longitude).toBe(116.4074);
          expect(content.name).toBe("Beijing");
        }
      });
    });

    describe("isStickerContent", () => {
      it("should return true for sticker content", () => {
        const content: MessageContent = { type: "sticker", stickerId: "sticker_001" };
        expect(isStickerContent(content)).toBe(true);
      });

      it("should return false for non-sticker content", () => {
        const content: MessageContent = { type: "text", text: "Hello" };
        expect(isStickerContent(content)).toBe(false);
      });

      it("should narrow type correctly with required stickerId", () => {
        const content: MessageContent = {
          type: "sticker",
          stickerId: "sticker_001",
          url: "https://example.com/sticker.webp",
          name: "Happy",
          format: "animated",
        };
        if (isStickerContent(content)) {
          expect(content.stickerId).toBe("sticker_001");
          expect(content.format).toBe("animated");
        }
      });
    });
  });

  describe("Type Discrimination", () => {
    it("should correctly discriminate all 7 content types", () => {
      const contents: MessageContent[] = [
        { type: "text", text: "Hello" },
        { type: "image", url: "https://example.com/image.png" },
        { type: "audio", url: "https://example.com/audio.mp3" },
        { type: "video", url: "https://example.com/video.mp4" },
        { type: "file", filename: "document.pdf" },
        { type: "location", latitude: 39.9042, longitude: 116.4074 },
        { type: "sticker", stickerId: "sticker_001" },
      ];

      const results = contents.map((content) => content.type);
      expect(results).toEqual(["text", "image", "audio", "video", "file", "location", "sticker"]);
    });

    it("should handle exhaustive switch with all types", () => {
      const assertNever = (_: never): void => {
        throw new Error("Unexpected type");
      };

      const processContent = (content: MessageContent): string => {
        switch (content.type) {
          case "text":
            return `Text: ${content.text}`;
          case "image":
            return `Image: ${content.url ?? content.base64 ?? content.path ?? "unknown"}`;
          case "audio":
            return `Audio: ${content.url ?? content.base64 ?? content.path ?? "unknown"}`;
          case "video":
            return `Video: ${content.url ?? content.base64 ?? content.path ?? "unknown"}`;
          case "file":
            return `File: ${content.filename}`;
          case "location":
            return `Location: (${content.latitude}, ${content.longitude})`;
          case "sticker":
            return `Sticker: ${content.stickerId}`;
          default:
            assertNever(content);
        }
      };

      const textContent: MessageContent = { type: "text", text: "Hello" };
      expect(processContent(textContent)).toBe("Text: Hello");
    });
  });

  describe("Optional Fields", () => {
    it("should handle undefined optional fields in TextContent", () => {
      const content: TextContent = { type: "text", text: "Hello" };
      expect(content.markdown).toBeUndefined();
    });

    it("should handle undefined optional fields in ImageContent", () => {
      const content: ImageContent = { type: "image" };
      expect(content.url).toBeUndefined();
      expect(content.base64).toBeUndefined();
      expect(content.path).toBeUndefined();
      expect(content.width).toBeUndefined();
      expect(content.height).toBeUndefined();
      expect(content.size).toBeUndefined();
      expect(content.mimeType).toBeUndefined();
      expect(content.caption).toBeUndefined();
    });

    it("should handle undefined optional fields in LocationContent", () => {
      const content: LocationContent = {
        type: "location",
        latitude: 39.9042,
        longitude: 116.4074,
      };
      expect(content.name).toBeUndefined();
      expect(content.address).toBeUndefined();
    });

    it("should handle undefined optional fields in StickerContent", () => {
      const content: StickerContent = { type: "sticker", stickerId: "sticker_001" };
      expect(content.url).toBeUndefined();
      expect(content.name).toBeUndefined();
      expect(content.format).toBeUndefined();
    });
  });
});
