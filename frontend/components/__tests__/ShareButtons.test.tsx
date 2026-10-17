import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import ShareButtons from "../ShareButtons";
import { useProjectShare } from "@/hooks/useProjectShare";

describe("ShareButtons", () => {
  const project = {
    id: "forest-restoration",
    name: "Trees & Solar",
    description: "Support clean energy and forest restoration.",
  } as Parameters<typeof useProjectShare>[0];

  beforeEach(() => {
    jest.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it.each([
    {
      target: "twitter",
      buttonName: /share on x/i,
      expectedIntent: "https://twitter.com/intent/tweet",
    },
    {
      target: "facebook",
      buttonName: /share on facebook/i,
      expectedIntent: "https://www.facebook.com/sharer/sharer.php",
    },
  ])("encodes the project URL and text for $target", ({ target, buttonName, expectedIntent }) => {
    process.env.NEXT_PUBLIC_APP_URL = "https://greenpay.example";
    const { result } = renderHook(() => useProjectShare(project));
    render(
      <ShareButtons
        onTwitter={result.current.handleTwitterShare}
        onFacebook={result.current.handleFacebookShare}
        onCopyLink={result.current.handleCopyLink}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    const rawUrl = jest.mocked(window.open).mock.calls[0][0] as string;
    const openedUrl = new URL(rawUrl);
    expect(openedUrl.origin + openedUrl.pathname).toBe(expectedIntent);
    expect(rawUrl).not.toContain(" ");

    if (target === "twitter") {
      expect(rawUrl).toMatch(/\?text=[^&]*&url=[^&]*$/);
      expect(rawUrl).toContain("%26");
      expect(openedUrl.searchParams.get("text")).toBe(
        "Support Trees & Solar on Stellar GreenPay and help offset CO₂! 🌍",
      );
      expect(openedUrl.searchParams.get("url")).toBe(
        "https://greenpay.example/projects/forest-restoration?utm_source=twitter&utm_medium=social&utm_campaign=project-share",
      );
    } else {
      expect(rawUrl).toMatch(/\?u=[^&]*$/);
      expect(rawUrl).toContain("%26");
      expect(openedUrl.searchParams.get("u")).toBe(
        "https://greenpay.example/projects/forest-restoration?utm_source=facebook&utm_medium=social&utm_campaign=project-share",
      );
    }
  });

  it("copies the project link and changes the button to its copied state", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderHook(() => useProjectShare(project));
    const props = {
      onTwitter: result.current.handleTwitterShare,
      onFacebook: result.current.handleFacebookShare,
      onCopyLink: result.current.handleCopyLink,
    };
    const { rerender } = render(<ShareButtons {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    const expectedLink =
      "https://stellar-greenpay.app/projects/forest-restoration?utm_source=copy-link&utm_medium=social&utm_campaign=project-share";
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expectedLink));
    await waitFor(() => expect(result.current.shareState).toBe("copied"));
    rerender(<ShareButtons {...props} copyState={result.current.shareState} />);

    expect(screen.getByRole("button", { name: /link copied/i })).toBeInTheDocument();
  });
});
