namespace NEvo.Messaging.Context;

public class MessageContextFactory(IServiceProvider serviceProvider) : IMessageContextFactory
{
    // TODO: custom headers
    public IMessageContext Create() => new MessageContext(new Dictionary<string, string>(), serviceProvider);
}