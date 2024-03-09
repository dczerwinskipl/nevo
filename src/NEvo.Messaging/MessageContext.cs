namespace NEvo.Messaging;

public class MessageContext : IMessageContext
{
    public IMessageContextHeaders Headers { get; }

    public MessageContext(IDictionary<string, string> headers)
    {
        Headers = new MessageContextHeaders(headers);
    }
}