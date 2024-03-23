namespace NEvo.Messaging.Context;

public interface IMessageContextFactory
{
    IMessageContext CreateContext();
    IMessageContextHeaders CreateHeaders();
}
