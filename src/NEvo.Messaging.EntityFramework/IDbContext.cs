using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace NEvo.Messaging.EntityFramework;

public interface IDbContext
{
    DbSet<TEntity> Set<TEntity>() where TEntity : class;

    int SaveChanges();
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);

    EntityEntry<TEntity> Add<TEntity>(TEntity entity) where TEntity : class;
    ValueTask<EntityEntry<TEntity>> AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken = default) where TEntity : class;

    EntityEntry<TEntity> Remove<TEntity>(TEntity entity) where TEntity : class;

    EntityEntry<TEntity> Update<TEntity>(TEntity entity) where TEntity : class;
}