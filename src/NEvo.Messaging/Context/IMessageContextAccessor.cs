namespace NEvo.Messaging.Context;

public interface IMessageContextAccessor
{
    IMessageContext? MessageContext { get; set; }
}
