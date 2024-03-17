namespace NEvo.Messaging;

public class MessageContextFactory(IServiceProvider serviceProvider) : IMessageContextFactory
{
    // TODO: custom headers
    public IMessageContext Create() => new MessageContext(new Dictionary<string,string>(), serviceProvider);
}