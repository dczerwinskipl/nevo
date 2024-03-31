using NEvo.Core;

namespace NEvo.Messaging.Context;

public class MessageContext(IDictionary<string, string> headers, IServiceProvider serviceProvider) : IMessageContext
{
    public IMessageContextHeaders Headers { get; } = new MessageContextHeaders(Check.Null(headers));

    public IServiceProvider ServiceProvider { get; } = Check.Null(serviceProvider);

    public bool SingleThread { get; internal set; }

    public void ForceSingleThread()
    {
        SingleThread = true;
    }
}
