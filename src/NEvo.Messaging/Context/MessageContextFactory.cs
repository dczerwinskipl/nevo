namespace NEvo.Messaging.Context;

public class MessageContextFactory(IServiceProvider serviceProvider) : IMessageContextFactory
{
    public IMessageContext CreateContext() => new MessageContext(CreateHeaders().ToDictionary(), serviceProvider);

    // TODO: custom headers (middleware?)
    public IMessageContextHeaders CreateHeaders() => new MessageContextHeaders(new Dictionary<string, string>());
}