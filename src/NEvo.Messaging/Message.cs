using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging;

[ExcludeFromCodeCoverage]
public record Message(Guid Id, DateTime CreatedAt) : IMessage
{
    public Message() : this(Guid.NewGuid(), DateTime.UtcNow) { }
}

[ExcludeFromCodeCoverage]
public record Message<TResult> : Message, IMessage<TResult>
{
    public Message() : base() { }
    public Message(Guid id, DateTime createdAt) : base(id, createdAt) { }
}