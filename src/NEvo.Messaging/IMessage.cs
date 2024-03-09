namespace NEvo.Messaging;

public interface IMessage
{
    Guid Id { get; }
    DateTime CreatedAt { get; }
}

public interface IMessage<TResult> : IMessage
{

}
