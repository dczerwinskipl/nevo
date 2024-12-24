namespace NEvo.Messaging.Context;

public interface IMessageContextProvider
{
    IMessageContext CreateContext();
    MessageContextHeaders CreateHeaders();
}
