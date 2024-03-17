using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Cqrs.Commands;

[ExcludeFromCodeCoverage]
public record Command : Message
{
    public Command() : base() { }
    public Command(Guid id, DateTime createdAt) : base(id, createdAt) { }
}
