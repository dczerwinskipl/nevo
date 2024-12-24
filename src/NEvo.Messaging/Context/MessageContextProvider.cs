namespace NEvo.Messaging.Context;

public class MessageContextProvider(IServiceProvider serviceProvider) : IMessageContextProvider
{
    private MessageContextHeaders? _messageContextHeaders;
    private MessageContext? _messageContext;

    public IMessageContext CreateContext() => _messageContext ??= new MessageContext(CreateHeaders(), serviceProvider);
    public MessageContextHeaders CreateHeaders() => _messageContextHeaders ??= new MessageContextHeaders(new Dictionary<string, string>());
}