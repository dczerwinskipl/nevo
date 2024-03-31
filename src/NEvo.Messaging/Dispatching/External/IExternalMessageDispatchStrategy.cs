namespace NEvo.Messaging.Dispatch.External;

public interface IExternalMessageDispatchStrategy : IMessageDispatchStrategy
{
    bool ShouldApply(IMessage message);
}