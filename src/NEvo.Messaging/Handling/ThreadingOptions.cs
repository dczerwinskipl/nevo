namespace NEvo.Messaging.Context;

public class ThreadingOptions
{
    public bool SingleThread { get; private set; } = false;
    public void ForceSingleThread()
    {
        SingleThread = true;
    }
}
