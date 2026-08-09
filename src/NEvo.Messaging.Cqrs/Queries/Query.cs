using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Cqrs.Queries;

[ExcludeFromCodeCoverage]
public abstract record Query<TResult> : Message<TResult>
{
    public Query() : base() { }
    public Query(Guid id, DateTime createdAt) : base(id, createdAt) { }
}
