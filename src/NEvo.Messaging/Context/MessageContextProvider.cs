namespace NEvo.Messaging.Context;

public class MessageContextProvider(IServiceProvider serviceProvider) : IMessageContextProvider
{
    private MessageContextHeaders? _messageContextHeaders;
    private MessageContext? _messageContext;

    public IMessageContext CreateContext()
    {
        if (_messageContext == null)
        {
            _messageContext = new MessageContext(CreateHeaders().ToDictionary(), serviceProvider);
        }

        return _messageContext;
    }

    // TODO: custom headers (middleware?)
    public IMessageContextHeaders CreateHeaders()
    {
        if (_messageContextHeaders == null)
        {
            _messageContextHeaders = new MessageContextHeaders(new Dictionary<string, string>());
        }

        return _messageContextHeaders;
    }
}